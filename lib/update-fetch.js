// System Objects
var path = require('path');
var fs = require('fs');

// Third Party Dependencies
var gunzip = require('zlib').createGunzip();
var extract = require('tar-stream').extract();
var Progress = require('t2-progress');
var streamToBuffer = require('stream-to-buffer');
var urljoin = require('url-join');
var semver = require('semver');
var { Readable } = require('stream');

// Internal
var log = require('./log');
var remote = require('./remote');

const BUILD_SERVER_ROOT = `https://${remote.BUILDS_HOSTNAME}/t2`;
const FIRMWARE_PATH = urljoin(BUILD_SERVER_ROOT, 'firmware');
const BUILDS_JSON_FILE = urljoin(FIRMWARE_PATH, 'builds.json');
const OPENWRT_BINARY_FILE = 'openwrt.bin';
const FIRMWARE_BINARY_FILE = 'firmware.bin';

const RESTORE_TGZ_URL = 'https://s3.amazonaws.com/builds.tessel.io/custom/new_build_next.tar.gz';
const RESTORE_UBOOT_FILE = 'openwrt-ramips-mt7620-Default-u-boot.bin';
const RESTORE_SQUASHFS_FILE = 'openwrt-ramips-mt7620-tessel-squashfs-sysupgrade.bin';

var exportables = {
  OPENWRT_BINARY_FILE,
  FIRMWARE_BINARY_FILE,
  RESTORE_UBOOT_FILE,
  RESTORE_SQUASHFS_FILE,
};

/*
  Requests a list of available builds from the
  build server. Returns list of build names in
  a Promise.
*/
exportables.requestBuildList = function() {
  return new Promise((resolve, reject) => {
    return remote.ifReachable(remote.BUILDS_HOSTNAME).then(() => {
      // Fetch the list of available builds
      fetch(BUILDS_JSON_FILE)
        .then(response => {
          var outcome = exportables.reviewResponse(response);
          // If there wasn't an issue with the request
          if (outcome.success) {
            return response.text();
          } else {
            throw new Error(outcome.reason);
          }
        })
        .then(body => {
          var builds;
          // Resolve with the parsed data
          try {
            builds = JSON.parse(body);
          }
          // If the parse failed, reject
          catch (err) {
            throw err;
          }

          // Sort the builds by semver version in chronological order
          builds.sort((a, b) => semver.compare(a.version, b.version));

          return resolve(builds);
        })
        .catch(reject);
    }).catch(reject);
  });
};

exportables.loadLocalBinaries = function(options) {
  var openwrtUpdateLoad = Promise.resolve(Buffer.alloc(0));
  var firmwareUpdateLoad = Promise.resolve(Buffer.alloc(0));

  if (options['openwrt-path']) {
    openwrtUpdateLoad = exportables.loadLocalBinary(options['openwrt-path']);
  }

  if (options['firmware-path']) {
    firmwareUpdateLoad = exportables.loadLocalBinary(options['firmware-path']);
  }

  return Promise.all([openwrtUpdateLoad, firmwareUpdateLoad])
    .then((images) => {
      if (images.length !== 2) {
        return Promise.reject(new Error('Invalid number of binaries loaded.'));
      } else {
        return {
          openwrt: images[0],
          firmware: images[1]
        };
      }
    });
};

// Reads a binary from a local path
exportables.loadLocalBinary = function(path) {
  return new Promise((resolve, reject) => {
    fs.readFile(path, (error, binary) => {
      if (error) {
        return reject(error);
      } else {
        resolve(binary);
      }
    });
  });
};

exportables.fetchRestore = function() {
  return exportables.downloadTgz(RESTORE_TGZ_URL, {
    uboot: RESTORE_UBOOT_FILE,
    squashfs: RESTORE_SQUASHFS_FILE
  });
};

/*
  Accepts a build name and attempts to fetch
  the build images from the server. Returns build contents
  in a Promise
*/
exportables.fetchBuild = function(build) {
  return exportables.downloadTgz(urljoin(FIRMWARE_PATH, `${build.sha}.tar.gz`), {
    firmware: FIRMWARE_BINARY_FILE,
    openwrt: OPENWRT_BINARY_FILE
  });
};

exportables.downloadTgz = function(tgzUrl, fileMap) {
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

    remote.ifReachable(remote.BUILDS_HOSTNAME).then(() => {
      var startTimeout = () => setTimeout(() => {
        reject(new Error('The attempt to download a build has timed out. Check your network connection and try again.'));
      }, 10000);
      var timeout = startTimeout();

      fetch(tgzUrl)
        .then(response => {
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          // Parse out the length of the incoming bundle
          var contentLength = parseInt(response.headers.get('content-length'), 10);

          // Create a new progress bar
          var bar = new Progress('     [:bar] :percent :etas remaining', {
            clear: true,
            complete: '=',
            incomplete: ' ',
            width: 20,
            total: contentLength
          });

          // Create a pass-through stream to track progress
          var { Transform } = require('stream');
          var progressStream = new Transform({
            transform(chunk, encoding, callback) {
              bar.tick(chunk.length);
              clearTimeout(timeout);
              timeout = startTimeout();
              callback(null, chunk);
            }
          });

          // Convert web ReadableStream to Node.js Readable and pipe through progress tracker
          Readable.fromWeb(response.body)
            .pipe(progressStream)
            .pipe(gunzip)
            .pipe(extract);
        })
        .catch(reject);
    }).catch(reject);
  });
};

exportables.reviewResponse = function(response) {
  var outcome = {
    success: true
  };

  // If there was an issue with the server endpoint, reject
  if (response.status !== 200) {
    outcome.success = false;
    outcome.reason = `Invalid status code on build server request: ${response.status}`;
  }

  return outcome;
};

exportables.findBuild = function(builds, property, value) {
  return builds.find(build => build[property] === value);
};


module.exports = exportables;
