// System Objects
import * as cp from 'node:child_process';
import * as path from 'node:path';
import * as util from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// Third Party Dependencies
import fs from 'fs-extra';

// Internal
import * as log from '../log.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

var options;
var resources = path.resolve(__dirname, './../../', 'resources/rust');
var exportables = {};

exportables.meta = {
	keywords: ['rust', 'rs'],
};

exportables.generateProject = (opts) => {
	// Save the options so they are accessible from all functions
	options = opts;

	return exportables
		.verifyCargoInstalled()
		.then(exportables.createSampleProgram);
};

exportables.createSampleProgram = () => {
	return new Promise((resolve, reject) => {
		// Files, directories, and paths
		var cargoToml = 'Cargo.toml';
		var mainRs = 'main.rs';
		var srcDir = path.resolve(options.directory, 'src/');
		var dirAndCargoToml = path.resolve(options.directory, cargoToml);
		var dirAndMainRs = path.resolve(srcDir, mainRs);

		// Generate the toml and the src file
		fs.exists(srcDir, (exists) => {
			if (exists) {
				return reject(new CargoExistsError(srcDir));
			}
			fs.exists(dirAndCargoToml, (exists) => {
				if (exists) {
					return reject(new CargoExistsError(dirAndCargoToml));
				}
				fs.mkdir(srcDir, (error) => {
					if (error) {
						return reject(new CreateError(srcDir, error));
					}

					fs.copy(path.join(resources, cargoToml), dirAndCargoToml, (error) => {
						if (error) {
							return reject(new CreateError(dirAndCargoToml, error));
						}
						log.info('Initialized Cargo project...');

						fs.copy(path.join(resources, mainRs), dirAndMainRs, (error) => {
							if (error) {
								return reject(new CreateError(dirAndMainRs, error));
							}

							log.info(`Wrote "Hello World" to ${dirAndMainRs}`);
							resolve();
						});
					});
				});
			});
		});
	});
};

// Verify the user has Cargo, reject if they do not
exportables.verifyCargoInstalled = () => {
	return new Promise((resolve, reject) => {
		cp.exec('cargo', (err, stdout, stderr) => {
			if (err || stderr) {
				return reject(
					new Error(
						'Rust or Cargo is not installed properly. You can re-install with: "curl -sf -L https://static.rust-lang.org/rustup.sh | sh"',
					),
				);
			}
			return resolve();
		});
	});
};

class CargoExistsError extends Error {
	constructor(filepath) {
		super(`Cargo Project Exists at ${filepath}`);
		this.name = this.constructor.name;
		Error.captureStackTrace(this, this.constructor);
	}
}

class CreateError extends Error {
	constructor(filepath, error) {
		super(`Could not create ${filepath}; ${error.toString()}`);
		this.name = this.constructor.name;
		Error.captureStackTrace(this, this.constructor);
	}
}

export default exportables;
