// System Objects
import * as path from 'node:path';
import * as fs from 'node:fs';
import { createGunzip } from 'node:zlib';

// Third Party Dependencies
import { extract as tarExtract } from 'tar-stream';
import Progress from 't2-progress';
import request from 'request';
import streamToBuffer from 'stream-to-buffer';
import urljoin from 'url-join';
import semver from 'semver';

// Internal
import * as log from './log.ts';
import * as remote from './remote.ts';

var gunzip = createGunzip();
var extract = tarExtract();

const BUILD_SERVER_ROOT = `https://${remote.BUILDS_HOSTNAME}/t2`;
const FIRMWARE_PATH = urljoin(BUILD_SERVER_ROOT, 'firmware');
const BUILDS_JSON_FILE = urljoin(FIRMWARE_PATH, 'builds.json');
export const OPENWRT_BINARY_FILE = 'openwrt.bin';
export const FIRMWARE_BINARY_FILE = 'firmware.bin';

const RESTORE_TGZ_URL =
	'https://s3.amazonaws.com/builds.tessel.io/custom/new_build_next.tar.gz';
export const RESTORE_UBOOT_FILE = 'openwrt-ramips-mt7620-Default-u-boot.bin';
export const RESTORE_SQUASHFS_FILE =
	'openwrt-ramips-mt7620-tessel-squashfs-sysupgrade.bin';

/**
  Requests a list of available builds from the
  build server. Returns list of build names in
  a Promise.
*/
export function requestBuildList() {
	return new Promise((resolve, reject) => {
		return remote
			.ifReachable(remote.BUILDS_HOSTNAME)
			.then(() => {
				// Fetch the list of available builds
				request.get(BUILDS_JSON_FILE, (err, response, body) => {
					if (err) {
						return reject(err);
					}

					var outcome = reviewResponse(response);
					var builds;
					// If there wasn't an issue with the request
					if (outcome.success) {
						// Resolve with the parsed data
						try {
							builds = JSON.parse(body);
						} catch (err) {
							// If the parse failed, reject
							reject(err);
						}

						// Sort the builds by semver version in chronological order
						builds.sort((a, b) => semver.compare(a.version, b.version));

						return resolve(builds);
					} else {
						reject(outcome.reason);
					}
				});
			})
			.catch(reject);
	});
}

export function loadLocalBinaries(options) {
	var openwrtUpdateLoad = Promise.resolve(Buffer.alloc(0));
	var firmwareUpdateLoad = Promise.resolve(Buffer.alloc(0));

	if (options['openwrt-path']) {
		openwrtUpdateLoad = loadLocalBinary(options['openwrt-path']);
	}

	if (options['firmware-path']) {
		firmwareUpdateLoad = loadLocalBinary(options['firmware-path']);
	}

	return Promise.all([openwrtUpdateLoad, firmwareUpdateLoad]).then((images) => {
		if (images.length !== 2) {
			return Promise.reject(new Error('Invalid number of binaries loaded.'));
		} else {
			return {
				openwrt: images[0],
				firmware: images[1],
			};
		}
	});
}

// Reads a binary from a local path
export function loadLocalBinary(path) {
	return new Promise((resolve, reject) => {
		fs.readFile(path, (error, binary) => {
			if (error) {
				return reject(error);
			} else {
				resolve(binary);
			}
		});
	});
}

export function fetchRestore() {
	return downloadTgz(RESTORE_TGZ_URL, {
		uboot: RESTORE_UBOOT_FILE,
		squashfs: RESTORE_SQUASHFS_FILE,
	});
}

/*
  Accepts a build name and attempts to fetch
  the build images from the server. Returns build contents
  in a Promise
*/
export function fetchBuild(build) {
	return downloadTgz(urljoin(FIRMWARE_PATH, `${build.sha}.tar.gz`), {
		firmware: FIRMWARE_BINARY_FILE,
		openwrt: OPENWRT_BINARY_FILE,
	});
}

export function downloadTgz(tgzUrl, fileMap) {
	return new Promise((resolve, reject) => {
		log.info('Downloading files...');

		var files = {};

		// Fetch the list of available files
		extract.on('entry', (header, stream, callback) => {
			// The buffer to save incoming data to
			// The filename of this entry
			var tgzFilename = path.basename(header.name);

			for (var key in fileMap) {
				var expectedFilename = fileMap[key];
				if (tgzFilename === expectedFilename) {
					return streamToBuffer(stream, (error, buffer) => {
						files[key] = buffer;
						callback();
					});
				}
			}
			callback();
		});

		extract.once('finish', () => {
			for (var key in files) {
				var file = files[key];
				if (!file.length) {
					return reject(new Error('Fetched file was not formatted properly.'));
				}
			}
			log.info('Download complete!');
			return resolve(files);
		});

		remote
			.ifReachable(remote.BUILDS_HOSTNAME)
			.then(() => {
				var req = request.get(tgzUrl);

				var startTimeout = () =>
					setTimeout(() => {
						reject(
							new Error(
								'The attempt to download a build has timed out. Check your network connection and try again.',
							),
						);
					}, 10000);
				var timeout = startTimeout();

				// When we receive the response
				req.on('response', (res) => {
					// Parse out the length of the incoming bundle
					var contentLength = parseInt(res.headers['content-length'], 10);

					// Create a new progress bar
					var bar = new Progress('     [:bar] :percent :etas remaining', {
						clear: true,
						complete: '=',
						incomplete: ' ',
						width: 20,
						total: contentLength,
					});

					// When we get incoming data, update the progress bar
					res.on('data', (chunk) => {
						bar.tick(chunk.length);
						clearTimeout(timeout);
						timeout = startTimeout();
					});

					// unzip and extract the binary tarball
					res.pipe(gunzip).pipe(extract);
				});
			})
			.catch(reject);
	});
}

export function reviewResponse(response) {
	var outcome = {
		success: true,
	};

	// If there was an issue with the server endpoint, reject
	if (response.statusCode !== 200) {
		outcome.success = false;
		outcome.reason = `Invalid status code on build server request: ${response.statusCode}`;
	}

	return outcome;
}

export function findBuild(builds, property, value) {
	return builds.find((build) => build[property] === value);
}
