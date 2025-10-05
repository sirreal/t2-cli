#!/usr/bin/env node

// System Objects
import * as child_process from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// Third Party Dependencies
import * as fsExtra from 'fs-extra';
import osenv from 'osenv';

// Internal
import * as log from './log.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function drivers() {
	return new Promise((resolve, reject) => {
		if (process.platform === 'linux') {
			// --loglevel may be at "error" for npm postinstall script.
			// if it's relevant, set the loglevel to info
			log.level('info');

			var tesselRules = '85-tessel.rules';
			var source = path.posix.join(__dirname, '/../resources/', tesselRules);
			var dest = `/etc/udev/rules.d/${tesselRules}`;

			try {
				fsExtra.copySync(source, dest);
			} catch (e) {
				if (e.code === 'EACCES') {
					log.error(`Could not write to ${dest}`);
					log.info('Run "sudo t2 install drivers"');
					return reject(-1);
				} else {
					return reject(e);
				}
			}
			log.info(`udev rules installed to ${dest}`);

			var udevadm = child_process.spawn('udevadm', [
				'control',
				'--reload-rules',
			]);
			udevadm.on('close', (code) => {
				if (code !== 0) {
					log.error('Error reloading udev');
					return reject(code);
				} else {
					log.info('Done. Unplug and re-plug Tessel to update permissions.');
					return resolve(code);
				}
			});
		} else {
			log.info('No driver installation necessary.');
			return resolve();
		}
	});
}

export function homedir() {
	var userTesselDirectory = path.join(osenv.home(), '.tessel');
	var preferencesJson = path.join(userTesselDirectory, 'preferences.json');

	return new Promise((resolve, reject) => {
		fsExtra.ensureDir(userTesselDirectory, (error) => {
			if (error) {
				return reject(error);
			}
			log.info('Home directory verified.');
			fsExtra.ensureFile(preferencesJson, (error) => {
				if (error) {
					return reject(error);
				}
				fsExtra.readJson(preferencesJson, (error, contents) => {
					let operation = 'verified';
					if (error || contents === undefined) {
						contents = {};
						operation = 'initialized';
					}

					fsExtra.outputJson(preferencesJson, contents, (error) => {
						if (error) {
							return reject(error);
						}
						log.info(`Preferences ${operation}.`);
						return resolve();
					});
				});
			});
		});
	});
}
