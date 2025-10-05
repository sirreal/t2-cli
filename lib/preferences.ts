// System Objects
import * as os from 'node:os';
import * as path from 'node:path';

// Third Party Dependencies
import fs from 'fs-extra';

// Internal
import * as log from './log.ts';

var preferencesJson = path.join(os.homedir(), '.tessel', 'preferences.json');
var Preferences = {};

Preferences.read = function (key, defaultValue) {
	return Preferences.load()
		.then((contents) => {
			if (contents) {
				return contents[key] || defaultValue;
			} else {
				return defaultValue;
			}
		})
		.catch((error) => {
			log.error('Error reading preference', key, error);
			return defaultValue;
		});
};

Preferences.write = function (key, value) {
	return new Promise((resolve, reject) => {
		Preferences.load()
			.then((contents) => {
				contents = contents || {};
				contents[key] = value;
				fs.ensureFile(preferencesJson, (error) => {
					if (error) {
						log.error('Error writing preference', key, value);
						reject(error);
					} else {
						fs.writeFile(preferencesJson, JSON.stringify(contents), (error) => {
							if (error) {
								log.error('Error writing preference', key, value);
								reject(error);
							} else {
								resolve();
							}
						});
					}
				});
			})
			.catch((error) => {
				reject(error);
			});
	});
};

Preferences.load = function () {
	return new Promise((resolve, reject) => {
		fs.exists(preferencesJson, (exists) => {
			if (exists) {
				fs.readFile(preferencesJson, (error, data) => {
					if (error) {
						reject(error);
					} else {
						resolve(JSON.parse(data));
					}
				});
			} else {
				// we don't have any local preferences
				// return falsy value
				resolve();
			}
		});
	});
};

export default Preferences;
