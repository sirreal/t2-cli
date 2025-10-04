// System Objects
var os = require('os');
var path = require('path');

// Third Party Dependencies
var fs = require('fs-extra');

// Internal
var log = require('./log');

var preferencesJson = path.join(os.homedir(), '.tessel', 'preferences.json');
var Preferences = {};

Preferences.read = function(key, defaultValue) {
  return Preferences.load().then(contents => {
      if (contents) {
        return contents[key] || defaultValue;
      } else {
        return defaultValue;
      }
    })
    .catch(error => {
      log.error('Error reading preference', key, error);
      return defaultValue;
    });
};

Preferences.write = async function(key, value) {
  try {
    let contents = await Preferences.load();
    contents = contents || {};
    contents[key] = value;
    await fs.ensureFile(preferencesJson);
    await fs.writeFile(preferencesJson, JSON.stringify(contents));
  } catch (error) {
    log.error('Error writing preference', key, value);
    throw error;
  }
};

Preferences.load = async function() {
  const exists = await fs.pathExists(preferencesJson);
  if (exists) {
    const data = await fs.readFile(preferencesJson, 'utf8');
    return JSON.parse(data);
  } else {
    // we don't have any local preferences
    // return falsy value
    return undefined;
  }
};

module.exports = Preferences;
