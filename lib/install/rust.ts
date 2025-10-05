// System Objects
import * as path from 'node:path';
import * as cp from 'node:child_process';
import * as stream from 'node:stream';
import * as zlib from 'node:zlib';

var Transform = stream.Transform;

// Third Party Dependencies
import blocks from 'block-stream2';
import bz2 from 'unbzip2-stream';
import createHash from 'sha.js';
import * as fs from 'node:fs';
import * as fsExtra from 'fs-extra/esm';
import fsTemp from 'fs-temp';
import osenv from 'osenv';
import Progress from 't2-progress';
import request from 'request';
import * as tags from 'common-tags';
import * as tar from 'tar-fs';

// Internal
import * as log from '../log.ts';
import * as remote from '../remote.ts';

const SDK_PATHS = {
	sdk: path.join(osenv.home(), '.tessel/sdk'),
	rustlib: path.join(osenv.home(), '.tessel/rust'),
};
const SDK_URLS = {
	macos: `https://${remote.BUILDS_HOSTNAME}/t2/sdk/t2-sdk-macos-x86_64.tar.bz2`,
	linux: `https://${remote.BUILDS_HOSTNAME}/t2/sdk/t2-sdk-linux-x86_64.tar.bz2`,
};

// Get the platform identifier. This actually conforms to the list of OSes
// Rust supports, not the value of process.platform, so we need to convert it.
// See: https://doc.rust-lang.org/std/env/consts/constant.OS.html
/* istanbul ignore next */
function getPlatform() {
	switch (process.platform) {
		case 'darwin':
			return 'macos';
		case 'linux':
			return 'linux';
		default:
			throw new Error(
				'Your platform is not yet supported for cross-compilation.',
			);
	}
}

/* istanbul ignore next */
function sha256stream() {
	var sha256 = createHash('sha256');
	var stream = new Transform();
	stream._transform = function (chunk, encoding, callback) {
		this.push(chunk);
		sha256.update(chunk);
		callback();
	};
	stream.on('finish', () => {
		stream.emit('sha256', sha256.digest('hex'));
	});
	return stream;
}

/* istanbul ignore next */
function sha256file(hash, name) {
	return `${hash}  ${name}\n`;
}

/* istanbul ignore next */
function download(url) {
	var req = request.get(url);

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
		});
	});

	return req;
}

/* istanbul ignore next */
function downloadString(url) {
	return new Promise((resolve, reject) => {
		request(
			{
				url,
				// We want to force Cloudfront to serve us the latest file.
				headers: {
					'Accept-Encoding': 'gzip, deflate',
				},
			},
			(error, response, body) => {
				if (!error && response.statusCode === 200) {
					resolve(body);
				} else {
					reject(error || response.statusCode);
				}
			},
		);
	});
}

// Creates a temp folder with a cleanup function. If anything goes wrong in
// unpacking data into a temp folder or moving it (fs.move may be non-atomic
// across disjoint filesystems) we want to delete the original temp folder,
// which could contain several hundred megabytes of now-useless data.
/* istanbul ignore next */
function tmpdir() {
	return new Promise((resolve) => {
		var dir = fsTemp.template('t2-sdk-%s').mkdirSync();
		resolve({
			path: dir,
			cleanup: () => {
				try {
					fsExtra.removeSync(dir);
				} catch (e) {
					// If the folder no longer exists, or if the remove operation throws
					// some error, this is non-fatal to the user (the data will just
					// exist until the temp folder is cleaned) and so we swallow any
					// errors.
				}
			},
		});
	});
}

/* istanbul ignore next */
export function toolchainPath() {
	return new Promise((resolve, reject) => {
		var sdkPlatformPath = path.join(SDK_PATHS.sdk, getPlatform());
		var values = fs.readdirSync(sdkPlatformPath);

		for (var i = 0; i < values.length; i++) {
			if (values[i].startsWith('toolchain-mipsel')) {
				return resolve(path.join(sdkPlatformPath, values[i]));
			}
		}
		return reject(new Error('No toolchain found.'));
	});
}

// Checks if CHECKSUM file in our SDK equals our expected checksum.
// This will resolve with checking that the SDK exists and matches the checksum.
/* istanbul ignore next */
export function checkTools(checksumVerify) {
	var dir = path.join(SDK_PATHS.sdk, getPlatform());
	return new Promise((resolve) => {
		var checksum = fs.readFileSync(path.join(dir, 'CHECKSUM'), 'utf-8');
		resolve({
			exists: true,
			isVerified: checksumVerify === checksum,
			path: dir,
		});
	}).catch(() => ({
		exists: false,
		isVerified: false,
		path: dir,
	}));
}

/* istanbul ignore next */
export function checkRustlib(rustv, checksumVerify) {
	var dir = path.join(SDK_PATHS.rustlib, rustv);
	return new Promise((resolve) => {
		var checksum = fs.readFileSync(path.join(dir, 'CHECKSUM'), 'utf-8');
		resolve({
			exists: true,
			isVerified: checksumVerify === checksum,
			path: dir,
		});
	}).catch(() => ({
		exists: false,
		isVerified: false,
		path: dir,
	}));
}

/* istanbul ignore next */
export function installTools() {
	var pkgname = 'Tessel build tools';
	var url = SDK_URLS[getPlatform()];
	var checksumVerify = null;

	return remote.ifReachable(remote.BUILDS_HOSTNAME).then(() => {
		return downloadString(`${url}.sha256`)
			.then((checksum) => {
				checksumVerify = checksum;
				return checkTools(checksumVerify);
			})
			.then((check) => {
				if (check.exists && check.isVerified) {
					log.info(`Latest ${pkgname} already installed.`);
					return;
				} else if (!check.exists) {
					log.info(`Installing ${pkgname}...`);
				} else {
					log.info(`Updating ${pkgname}...`);
				}

				fs.mkdirSync(path.join(osenv.home(), '.tessel/sdk'), {
					recursive: true,
				});
				return extractTools(checksumVerify, path.basename(url), download(url));
			});
	});
}

/* istanbul ignore next */
export function installRustlib() {
	return rustVersion().then((rustv) => {
		var pkgname = `MIPS libstd v${rustv}`;
		var url = `https://${remote.BUILDS_HOSTNAME}/t2/sdk/t2-rustlib-${rustv}.tar.gz`;
		var checksumVerify;

		return downloadString(url + '.sha256')
			.catch(() =>
				Promise.reject(
					`Could not find a MIPS libstd matching your current Rust version (${rustv}).`,
				),
			)
			.then((checksum) => {
				checksumVerify = checksum;
				return checkRustlib(rustv, checksumVerify);
			})
			.then((check) => {
				if (check.exists && check.isVerified) {
					log.info(`Latest ${pkgname} already installed.`);
					return;
				} else if (!check.exists) {
					log.info(`Installing ${pkgname}...`);
				} else {
					log.info(`Updating ${pkgname}...`);
				}

				fs.mkdirSync(SDK_PATHS.rustlib, { recursive: true });
				return extractRustlib(
					checksumVerify,
					path.basename(url),
					download(url),
					rustv,
				);
			});
	});
}

/* istanbul ignore next */
function extract(
	checksumVerify,
	filename,
	sdkStream,
	root,
	strip,
	name,
	decompress,
) {
	return tmpdir().then((destdir) => {
		// Exract tarball to destination.
		var extract = tar.extract(destdir.path, {
			strip: strip,
			ignore: function (name) {
				// Ignore self-directory.
				return (
					path.normalize(name + '/') === path.normalize(destdir.path + '/')
				);
			},
		});

		return new Promise((resolve, reject) => {
			var checksum = '';
			sdkStream
				.pipe(sha256stream())
				.on('sha256', function (sha256) {
					checksum = sha256file(sha256, filename);
				})
				.pipe(decompress)
				// tar-stream has a recursion issue when input chunks are too big.
				// by splitting up the chunks, we never get too deeply nested in the
				// stack.
				.pipe(
					blocks({
						size: 64 * 1024,
						zeroPadding: false,
					}),
				)
				.pipe(extract)
				.on('finish', () => {
					// Check sum.
					if (checksum !== checksumVerify) {
						return reject(tags.stripIndent`
                Please file an issue on https://github.com/tessel/t2-cli with the following:
                The downloaded file ${name} is invalid (wrong checksum).
                  expected: ${checksumVerify}
                  got:      ${checksum}`);
					}

					// Write out CHECKSUM file.
					fs.writeFileSync(path.join(destdir.path, 'CHECKSUM'), checksum);

					try {
						// Remove the old SDK directory.
						fsExtra.removeSync(root);
						// Move temporary directory to target destination.
						fsExtra.move(destdir.path, root, (error) => {
							if (error) {
								// Cleanup temp dir.
								destdir.cleanup();
								reject(error);
							} else {
								resolve();
							}
						});
					} catch (error) {
						// Cleanup temp dir.
						destdir.cleanup();
						reject(error);
					}
				})
				.on('error', (error) => {
					destdir.cleanup();
					reject(error);
				});
		});
	});
}

/* istanbul ignore next */
function extractTools(checksumVerify, filename, sdkStream) {
	var root = path.join(SDK_PATHS.sdk, getPlatform());
	return extract(
		checksumVerify,
		filename,
		sdkStream,
		root,
		2,
		'Tessel build tools',
		bz2(),
	);
}

/* istanbul ignore next */
function extractRustlib(checksumVerify, filename, sdkStream, rustVersion) {
	var root = path.join(SDK_PATHS.rustlib, rustVersion);
	return extract(
		checksumVerify,
		filename,
		sdkStream,
		root,
		0,
		'MIPS libstd',
		zlib.createGunzip(),
	);
}

/* istanbul ignore next */
export function getBuildConfig() {
	var config = {
		rustv: null,
		toolchainPath: null,
		stagingDir: null,
		rustlibPath: null,
		name: null,
		path: null,
	};

	return rustVersion()
		.then((rustv) => {
			config.rustv = rustv;

			return checkTools();
		})
		.then((check) => {
			if (!check.exists) {
				throw new Error('Tessel cross-compilation tools are not installed.');
			}
			config.stagingDir = check.path;

			return checkRustlib(config.rustv);
		})
		.then((check) => {
			if (!check.exists) {
				throw new Error(`MIPS libstd v${config.rustv} not installed.`);
			}
			config.rustlibPath = check.path;

			return toolchainPath();
		})
		.then((toolchainPath) => {
			config.toolchainPath = toolchainPath;

			return config;
		});
}

// Confirms that the user has a version of rustc and cargo installed. Resolves
// with the current rustc version, rejects if either executable is not found
// on the system.
/* istanbul ignore next */
export function rustVersion() {
	// Check that rustc exists and get its version.
	return new Promise((resolve, reject) => {
		var rustc = cp.spawn('rustc', ['-V']);
		var rustcOut = [];
		rustc.stdout.on('data', (data) => {
			rustcOut.push(data);
		});
		rustc.on('error', reject);
		rustc.on('close', (status) => {
			var out = Buffer.concat(rustcOut).toString();
			var matches = out.match(/^rustc\s+(\S+)/);
			if (status !== 0 || !matches) {
				return reject(
					new Error('Could not find a locally installed version of "rustc".'),
				);
			}

			var version = matches[1];

			// Check if cargo exists also.
			var cargo = cp.spawn('cargo', ['-V']);
			cargo.on('error', reject);
			cargo.on('close', (status) => {
				if (status !== 0) {
					return reject(
						new Error('Could not find a locally installed version of "cargo".'),
					);
				}

				resolve(version);
			});
		});
	});
}

// Check the targets of a cargo crate.
/* istanbul ignore next */
export function cargoMetadata(destdir) {
	return new Promise((resolve, reject) => {
		var cargo = cp.spawn('cargo', ['metadata', '--no-deps'], {
			stdio: ['ignore', 'pipe', 'inherit'],
			cwd: destdir || process.cwd(),
		});
		var stdout = [];
		cargo.stdout.on('data', (data) => {
			stdout.push(data);
		});
		cargo.on('error', reject);
		cargo.on('close', (status) => {
			if (status !== 0) {
				reject(
					`Could not find a cargo project in ${destdir || 'this directory.'}.`,
				);
			} else {
				resolve(JSON.parse(Buffer.concat(stdout).toString()));
			}
		});
	});
}

/* istanbul ignore next */
export function buildTessel(config) {
	var env = Object.assign({}, process.env, {
		STAGING_DIR: config.stagingDir,
		RUST_TARGET_PATH: config.rustlibPath,
		PATH: `${path.join(config.toolchainPath, 'bin')}:${process.env.PATH}`,
		RUSTFLAGS: `-L ${config.rustlibPath}`,
	});

	return new Promise((resolve, reject) => {
		var cargo = cp.spawn(
			'cargo',
			['build', '--target=tessel2', '--bin', config.name, '--release'],
			{
				env: env,
				pwd: config.path || process.cwd(),
				stdio: ['ignore', 'inherit', 'inherit'],
			},
		);

		cargo.on('error', (error) => {
			reject(error);
		});

		cargo.on('close', (code) => {
			if (code !== 0) {
				reject(`"cargo build" exited with status code ${code}`);
			} else {
				resolve();
			}
		});
	});
}

/* istanbul ignore next */
export function bundleTessel(config) {
	return new Promise((resolve) => {
		var tarball = path.join(path.dirname(config.path), 'tessel-bundle.tar');
		tar
			.pack(path.dirname(config.path), {
				entries: [path.basename(config.path)],
			})
			.pipe(fs.createWriteStream(tarball))
			.on('finish', function () {
				resolve(tarball);
			});
	});
}

/* istanbul ignore next */
export const cargo = {
	install: () => {
		checkRust({
			isCli: false,
		});

		return installTools().then(() => {
			return installRustlib().then(
				() => {
					log.info('SDK installed.');
				},
				(e) => {
					log.error(e.message);
					log.error(
						'Please switch to using a stable Rust version >= 1.11.0 and try again.',
					);
					log.warn(
						'SDK toolchain is installed, but a libstd for your Rust version is not.',
					);
				},
			);
		});
	},
	uninstall: () => {
		return new Promise((resolve) => {
			fsExtra.remove(path.join(osenv.home(), '.tessel/rust'), () => {
				fsExtra.remove(path.join(osenv.home(), '.tessel/sdk'), () => {
					log.info('Tessel SDK uninstalled.');
					resolve();
				});
			});
		});
	},
};

// Logging function that checks if all rust components are installed.
/* istanbul ignore next */
export function checkSdk() {
	return getBuildConfig().catch((error) =>
		Promise.reject(tags.stripIndent`
      Could not find all the components for cross-compiling Rust:
      ${error.message}
      Please run "cargo tessel sdk install" and try again.
      To instead use the remote Rust compiler, use "t2 run <target> --rustcc".`),
	);
}

/* istanbul ignore next */
export function checkRust(opts) {
	return rustVersion().catch(() =>
		Promise.reject(tags.stripIndent`
        "rustc" and "cargo" are required to cross-compile for Tessel.
        Please install Rust on your machine: https://rustup.rs/
        ${opts.isCli ? 'To instead use the remote Rust compiler, use "t2 run <target> --rustcc".' : ''}`),
	);
}

// Logging function that checks if rust is installed, then if the binary matches.
// opts matches { isCli: boolean, binary: String[, path: String] }
/* istanbul ignore next */
export function checkBinaryName(opts) {
	return cargoMetadata(opts.path).then((metadata) => {
		return new Promise((resolve, reject) => {
			// Get first package.
			var pkg = metadata.packages.pop();
			var bins = pkg.targets.filter(
				(target) => target.kind.indexOf('bin') > -1,
			);

			// Filter by --bin argument.
			var validBins = bins.filter((bin) => bin.name === opts.binary);

			// Throw if multiple bins exist.
			if (validBins.length === 0) {
				var message;
				if (!opts.binary) {
					message = 'Please specify a valid binary target with --bin.';
				} else {
					message = tags.stripIndent`
              No binary target "${opts.binary}" exists for this Rust crate.
              Make sure you specify a valid binary using --bin.`;
				}
				if (bins.length > 0) {
					message += '\nAvailable targets:';
					bins.forEach((bin) => {
						if (opts.isCli) {
							message += `\n  t2 run ${bin.name}`;
						} else {
							message += `\n  cargo tessel build --bin ${bin.name}`;
						}
					});
				}
				return reject(message);
			}

			var name = validBins[0].name;
			var dest = path.join(
				path.dirname(pkg.manifest_path),
				'target/tessel2/release',
				name,
			);

			resolve({
				name,
				path: dest,
			});
		});
	});
}

// opts matches { isCli: boolean, binary: String[, path: String] }
/* istanbul ignore next */
export function runBuild(opts) {
	return checkRust({
		isCli: opts.isCli,
	})
		.then(() => checkBinaryName(opts))
		.then((out) => {
			return checkSdk().then((config) => {
				config.name = out.name;
				config.path = out.path;

				return buildTessel(config).then(() => bundleTessel(config));
			});
		});
}
