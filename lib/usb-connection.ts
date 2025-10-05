// System Objects
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import { inherits } from 'node:util';
import { Duplex } from 'node:stream';
import { EventEmitter } from 'node:events';
import { execSync } from 'node:child_process';
import { usb } from 'usb';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

var Emitter = EventEmitter;

// Third Party Dependencies
import tags from 'common-tags';

// Internal
import * as DFU from './dfu.ts';
import * as log from './log.ts';

function debug(message) {
	log.debug(`(discovery:usb) ${message}`);
}

function debugCommands(message) {
	log.debug(`(commands:usb) ${message}`);
}

var isUSBAvailable = true;
var VENDOR_REQ_OUT;
try {
	// Dynamic require for optional dependency
	VENDOR_REQ_OUT =
		usb.LIBUSB_REQUEST_TYPE_VENDOR |
		usb.LIBUSB_RECIPIENT_DEVICE |
		usb.LIBUSB_ENDPOINT_OUT;
	// var VENDOR_REQ_IN  = usb.LIBUSB_REQUEST_TYPE_VENDOR | usb.LIBUSB_RECIPIENT_DEVICE | usb.LIBUSB_ENDPOINT_IN;
} catch (error) {
	isUSBAvailable = false;

	// do not exit the process during tests because usb is not needed to run them
	/* istanbul ignore next */
	if (!global.IS_TEST_ENV) {
		log.error('Node version mismatch for USB drivers.');
		log.info(tags.stripIndent`
      Automatically rebuilding USB drivers for t2-cli to correct this issue. Please try running your command again.

      If the error persists, please file an issue at https://github.com/tessel/t2-cli/issues/new with this warning.
    `);
		execSync(`cd ${__dirname} && npm rebuild --update-binary usb`);
		process.exit(1);
	}
}

import { daemon as Daemon } from './usb/usb-daemon.ts';

export const TESSEL_VID = 0x1209;
export const TESSEL_PID = 0x7551;
const REQ_BOOT = 0xbb;

export class USBConnection extends Duplex {
	private closed: boolean = false;

	constructor(device) {
		super();
		this.device = device;
		this.connectionType = 'USB';
		this.epIn = undefined;
		this.epOut = undefined;
	}

	exec(command, options, callback) {
		// Account for the case where options are not provided but a callback is
		if (typeof options === 'function') {
			callback = options;
			options = {};
		}

		// Account for the case where a callback wasn't provided
		if (callback === undefined) {
			// Dummy callback
			callback = function () {};
		}

		// Execute the command
		if (!Array.isArray(command)) {
			return callback(
				new Error('Command to execute must be an array of args.'),
			);
		}

		// Log executed command
		debugCommands(command);

		// Create a new process
		Daemon.openProcess(this, (err, proc) => {
			if (err) {
				return callback(err);
			} else {
				// Format the args into something the USB protocol can understand
				command = this._processArgsForTransport(command);

				// Write the bash command
				proc.control.end(command);

				// Once the command has been written, call the callback with the resulting process
				proc.control.once('finish', () => callback(null, proc));
			}
		});
	}

	_write(chunk, enc, callback) {
		if (this.closed) {
			callback(new Error('Connection was already closed...'));
		} else {
			this.epOut.transfer(chunk, callback);
		}
	}

	_read() {
		if (this.closed) {
			return this.push(null);
		}
	}

	_receiveMessages() {
		// Default transfer size
		var transferSize = 4096;
		// Start polling
		this.epIn.startPoll(2, transferSize);
		// When we get data, push it into the stream
		this.epIn.on('data', (data) => this.push(data));
	}

	open(altSetting) {
		altSetting = altSetting || altSetting === 0 ? altSetting : 2;

		// Try to open connection
		try {
			this.device.open();
			this.closed = false;
		} catch (e) {
			if (e.message === 'LIBUSB_ERROR_ACCESS' && process.platform === 'linux') {
				log.error(
					'Please run `sudo t2 install drivers` to fix device permissions.\n(Error: could not open USB device.)',
				);
			}
			// Reject if error
			return Promise.reject(e);
		}

		// Try to initialize interface
		this.intf = this.device.interface(0);
		try {
			this.intf.claim();
		} catch (e) {
			// Reject if error
			return Promise.reject(e);
		}

		// Set interface settings
		var p = this.setAltSetting(altSetting).then(() => {
			this.epIn = this.intf.endpoints[0];
			this.epOut = this.intf.endpoints[1];
			if (!this.epIn || !this.epOut) {
				return Promise.reject(
					new Error('Device endpoints were not able to be loaded'),
				);
			}

			// Map desciptions
			return new Promise((resolve, reject) => {
				this.device.getStringDescriptor(
					this.device.deviceDescriptor.iSerialNumber,
					(err, data) => {
						if (err) {
							reject(err);
						} else {
							this.serialNumber = data;
							resolve();
						}
					},
				);
			});
		});

		if (altSetting === 1) {
			return p.then(() => {
				return Promise.resolve(this);
			});
		}

		return p.then(() => {
			// Register this connection with daemon (keeps track of active remote processes)
			Daemon.register(this);

			return new Promise((resolve, reject) => {
				// If the USB Pipe isn't enabled on the other end (ie it is booting)
				this.epIn.on('error', (err) => {
					// Close the device resources
					this._close();
					// Catch the error and return if we haven't already
					return reject(err);
				});

				// Start receiving messages
				this._receiveMessages();

				// If all is well, resolve the promise with the valid connection
				resolve(this);
			});
		});
	}

	setAltSetting(altSetting) {
		return new Promise((resolve, reject) => {
			// Set interface settings
			this.intf.setAltSetting(0, (error) => {
				if (error) {
					return reject(error, this);
				} else {
					// Set interface settings
					this.intf.setAltSetting(altSetting, (error) => {
						if (error) {
							return reject(error, this);
						} else {
							return resolve();
						}
					});
				}
			});
		});
	}

	end() {
		return new Promise((resolve, reject) => {
			// Tell the USB daemon to end all processes active
			// on account of this connection
			Daemon.deregister(this, (err) => {
				if (err) {
					reject(err);
				} else {
					this._close(resolve);
				}
			});
		});
	}

	_close(callback) {
		if (typeof callback !== 'function') {
			callback = function () {};
		}

		if (this.closed) {
			setImmediate(callback);
			return;
		}

		this.closed = true;

		this.epIn.stopPoll(() => {
			var attempt = () => {
				try {
					this.device.close();
				} catch (_) {
					setTimeout(attempt, 100);
					return;
				}

				callback(null);
			};

			this.intf.release(true, attempt);
		});
	}

	// Returns a device in DFU mode
	enterBootloader() {
		return new Promise((resolve) => {
			this.epIn.stopPoll(resolve);
		})
			.then(() => {
				return new Promise((resolve, reject) => {
					Daemon.deregister(this, function (err) {
						if (err) {
							reject(err);
						} else {
							resolve();
						}
					});
				});
			})
			.then(() => {
				// Tell the mcu to go into bootloader mode
				return new Promise((resolve, reject) => {
					this.device.controlTransfer(
						VENDOR_REQ_OUT,
						REQ_BOOT,
						0,
						0,
						Buffer.alloc(0),
						function (err) {
							if (err) {
								reject(err);
							} else {
								resolve();
							}
						},
					);
				});
			})
			.then(() => {
				// Wait for it to tenter the mode
				return this._waitUntilInBootloader();
			})
			.then((device) => {
				return new Promise(function (resolve, reject) {
					// Find the DFU interface
					var dfu = new DFU(device, 0);

					// Claim the USB device
					dfu.claim(function (err) {
						if (err) {
							return reject(err);
						} else {
							// Return the DFU device
							resolve(dfu);
						}
					});
				});
			});
	}

	// Waits until it finds a USB device that is a Tessel with a bootloader
	// and returns that USB device
	_waitUntilInBootloader() {
		var retryCount = 10;
		var retryTimeout = 250;
		return new Promise((resolve, reject) => {
			var retry = () => {
				this._findBootedDeviceBySerialNumber(
					this.device.deviceDescriptor.iSerialNumber,
				)
					// A  Tessel was found!
					.then(
						function (bootedDevice) {
							// Make sure it's in the proper mode
							if (bootedDevice) {
								return resolve(bootedDevice);
							}
							// It didn't find it
						},
						function (err) {
							if (--retryCount > 0) {
								return setTimeout(retry, retryTimeout);
							} else {
								reject(err);
							}
						},
					);
			};

			setTimeout(retry, retryTimeout);
		});
	}

	// Looks through all attached USB devices for a Tessel in bootloader mode
	_findBootedDeviceBySerialNumber(serialNumber) {
		return new Promise(function (resolve, reject) {
			// Fetch all attached USB devices
			if (usb) {
				var list = usb.getDeviceList();

				for (var i = 0; i < list.length; i++) {
					console.log({ device });
					var device = list[i];
					// Make sure this is a Tessel
					if (
						device.deviceDescriptor.idVendor === TESSEL_VID &&
						device.deviceDescriptor.idProduct === TESSEL_PID &&
						device.deviceDescriptor.iSerialNumber === serialNumber
					) {
						// Make sure it's in bootloader mode
						if (device.deviceDescriptor.bcdDevice >> 8 === 0) {
							return resolve(device);
						}
					}
				}
			}
			return reject(new Error('No device found in bootloader mode'));
		});
	}

	_processArgsForTransport(command) {
		if (!Array.isArray(command)) {
			return;
		}

		// For each command
		command.forEach(function (arg, i) {
			// If this isn't the last item
			if (i !== command.length - 1) {
				// Demarcate the end of an arg with a null byte
				command[i] += '\0';
			}
		});

		// Join all the args into a string
		command = command.join('');

		return command;
	}
}

var scanner: USBScanner | null = null;

export function startScan() {
	if (scanner === null) {
		scanner = new USBScanner();
		setImmediate(() => scanner.start());
	}

	return scanner;
}

export function stopScan() {
	if (scanner !== null) {
		scanner.stop();
		scanner = null;
	}

	return scanner;
}

export class USBScanner extends Emitter {
	start() {
		var deviceInspector = (device) => {
			if (
				device.deviceDescriptor.idVendor === TESSEL_VID &&
				device.deviceDescriptor.idProduct === TESSEL_PID
			) {
				debug('Device found.');
				var connection = new USBConnection(device);
				this.emit('connection', connection);
			}
		};

		if (isUSBAvailable) {
			usb.getDeviceList().forEach(deviceInspector);

			usb.on('attach', deviceInspector);
		}
	}

	stop() {
		if (isUSBAvailable) {
			usb.removeAllListeners('attach');
		}
	}
}
