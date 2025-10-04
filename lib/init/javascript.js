'use strict';

// System Objects
const path = require('path');
const cp = require('child_process');
const util = require('util');

// Third Party Dependencies
const fs = require('fs-extra');
const PZ = require('promzard').PromZard;

// Internal
const log = require('../log');
const glob = require('../tessel/deployment/glob');

const execFile = util.promisify(cp.execFile);

let pkg, ctx, options;
let packageJson = path.resolve('./package.json');
let resources = path.resolve(__dirname, './../../', 'resources/javascript');
let exportables = {};

exportables.meta = {
  keywords: ['javascript', 'js'],
};

exportables.loadNpm = () => {
  // Get npm config via command line
  return execFile('npm', ['config', 'list', '--json'])
    .then(result => {
      try {
        return JSON.parse(result.stdout);
      } catch (e) {
        return {};
      }
    })
    .catch(() => {
      // If npm config fails, return empty object
      return {};
    });
};

// Resolve an npm cofig list, or nothing (existance is not needed)
exportables.resolveNpmConfig = npmConfig => {
  // Always resolve, we don't care if there isn't an npm config.
  return Promise.resolve(npmConfig || {});
};

// Builds the package.json file and writes it to the directory
// This is ignored for now because it includes global state vars
// that can't be stubbed. Until we can fix that, we'll ignore it.
/* istanbul ignore next */
exportables.buildJSON = npmConfig => {
  return new Promise((resolve, reject) => {
    // Path to promzard config file
    var promzardConfig;
    ctx.config = npmConfig;
    // Default to auto config
    promzardConfig = path.join(resources, 'init-default.js');
    if (options.interactive) {
      promzardConfig = path.join(resources, 'init-config.js');
    }

    // Init promozard with appropriate config.
    var pz = new PZ(promzardConfig, ctx);

    // On data resolve the promise with data
    pz.on('data', data => {
      if (!pkg) {
        pkg = {};
      }
      Object.keys(data).forEach(function(k) {
        if (data[k] !== undefined && data[k] !== null) {
          pkg[k] = data[k];
        }
      });

      log.info('Created "package.json".');
      resolve(data);
    });

    // On error, reject with error;
    pz.on('error', error => {
      reject(error);
    });
  });
};

// Returns the dependencies of the package.json file
exportables.getDependencies = pkg => {
  // Let's find the dependencies that were installed
  // by the author...
  const dependencies = new Set();
  const packageFiles = glob.sync('node_modules/*/package.json');
  const authorInstalledDependencies = packageFiles.reduce((accum, file) => {
    const content = require(path.join(process.cwd(), file));

    if (content._requiredBy && content._requiredBy.includes('#USER')) {
      accum[content.name] = content.version;
    }
    return accum;
  }, {});

  if (typeof pkg.dependencies === 'undefined') {
    pkg.dependencies = [];
  }
  // pkg.dependencies will contain saved deps
  // authorInstalledDependencies will contain author installed
  // dependencies that were not necessarily saved.
  //
  Object.assign(pkg.dependencies, authorInstalledDependencies);

  for (const mod in pkg.dependencies) {
    dependencies.add(`${mod}@${pkg.dependencies[mod]}`);
  }

  return Array.from(dependencies);
};

// Installs npm and dependencies
exportables.npmInstall = dependencies => {
  // If there are no dependencies resolve
  if (!dependencies.length) {
    return Promise.resolve();
  }

  // Use npm install via child_process
  return execFile('npm', ['install', ...dependencies], {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024 * 10 // 10MB buffer
  })
    .then(() => {
      log.info('Dependencies installed successfully');
    })
    .catch(error => {
      log.error('Failed to install dependencies:', error.message);
      throw error;
    });
};

// Generates blinky for JavaScript
exportables.createSampleProgram = async () => {
  const filename = 'index.js';

  // If an index.js already exists
  const exists = await fs.pathExists(filename);
  if (exists) {
    return;
  }

  await fs.copy(path.join(resources, filename), filename);
  log.info('Created "index.js"');
};

exportables.createNpmrc = async () => {
  const npmrc = '.npmrc';
  const exists = await fs.pathExists(npmrc);
  if (exists) {
    return;
  }
  await fs.copy(path.join(resources, 'npmrc'), npmrc);
  log.info('Created ".npmrc".');
};

exportables.createTesselinclude = async () => {
  const tesselinclude = '.tesselinclude';
  const exists = await fs.pathExists(tesselinclude);
  if (exists) {
    return;
  }
  await fs.copy(path.join(resources, tesselinclude), tesselinclude);
  log.info('Created ".tesselinclude".');
};

exportables.readPackageJson = () => {
  return fs.readFile(packageJson, 'utf8');
};

exportables.writePackageJson = data => {
  return fs.writeFile(packageJson, data);
};

exportables.prettyPrintJson = data => {
  return JSON.stringify(data, null, 2);
};

// This is ignored for now because it includes global state vars
// that can't be stubbed. Until we can fix that, we'll ignore it.
/* istanbul ignore next */
exportables.generateProject = opts => {
  // Make the options global
  options = opts;

  log.info('Initializing new Tessel project for JavaScript...');
  return exportables
    .readPackageJson()
    .then(data => {
      // Try to parse current package JSON
      try {
        ctx = pkg = JSON.parse(data);
      } catch (e) {
        // if it can't parse, then just make an object
        ctx = {};
      }

      ctx.dirname = path.dirname(packageJson);
      ctx.basename = path.basename(ctx.dirname);

      if (!ctx.version) {
        ctx.version = undefined;
      }
      return ctx;
    })
    .catch(() => {
      ctx = {};
      ctx.dirname = path.dirname(packageJson);
      ctx.basename = path.basename(ctx.dirname);
      ctx.version = undefined;
      return ctx;
    })
    .then(exportables.createNpmrc)
    .then(exportables.createTesselinclude)
    .then(exportables.createSampleProgram)
    .then(exportables.loadNpm)
    .then(exportables.resolveNpmConfig)
    .then(exportables.buildJSON)
    .then(exportables.prettyPrintJson)
    .then(exportables.writePackageJson)
    .then(exportables.readPackageJson)
    .then(JSON.parse)
    .then(exportables.getDependencies)
    .then(exportables.npmInstall)
    .catch(error => {
      log.error(error);
    });
};

module.exports = exportables;
