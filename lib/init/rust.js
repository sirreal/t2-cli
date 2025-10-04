// System Objects
var cp = require('child_process');
var path = require('path');
var util = require('util');

// Third Party Dependencies
var fs = require('fs-extra');

// Internal
var log = require('../log');

var options;
var resources = path.resolve(__dirname, './../../', 'resources/rust');
var exportables = {};

exportables.meta = {
  keywords: ['rust', 'rs']
};

exportables.generateProject = (opts) => {

  // Save the options so they are accessible from all functions
  options = opts;

  return exportables.verifyCargoInstalled()
    .then(exportables.createSampleProgram);
};

exportables.createSampleProgram = async () => {
  // Files, directories, and paths
  const cargoToml = 'Cargo.toml';
  const mainRs = 'main.rs';
  const srcDir = path.resolve(options.directory, 'src/');
  const dirAndCargoToml = path.resolve(options.directory, cargoToml);
  const dirAndMainRs = path.resolve(srcDir, mainRs);

  // Generate the toml and the src file
  if (await fs.pathExists(srcDir)) {
    throw new CargoExistsError(srcDir);
  }
  if (await fs.pathExists(dirAndCargoToml)) {
    throw new CargoExistsError(dirAndCargoToml);
  }

  try {
    await fs.mkdir(srcDir);
  } catch (error) {
    throw new CreateError(srcDir, error);
  }

  try {
    await fs.copy(path.join(resources, cargoToml), dirAndCargoToml);
    log.info('Initialized Cargo project...');
  } catch (error) {
    throw new CreateError(dirAndCargoToml, error);
  }

  try {
    await fs.copy(path.join(resources, mainRs), dirAndMainRs);
    log.info(`Wrote "Hello World" to ${dirAndMainRs}`);
  } catch (error) {
    throw new CreateError(dirAndMainRs, error);
  }
};

// Verify the user has Cargo, reject if they do not
exportables.verifyCargoInstalled = () => {
  return new Promise((resolve, reject) => {
    cp.exec('cargo', (err, stdout, stderr) => {
      if (err || stderr) {
        return reject(new Error('Rust or Cargo is not installed properly. You can re-install with: "curl -sf -L https://static.rust-lang.org/rustup.sh | sh"'));
      }
      return resolve();
    });
  });
};

function CargoExistsError(filepath) {
  Error.captureStackTrace(this, this.constructor);
  this.name = this.constructor.name;
  this.message = `Cargo Project Exists at ${filepath}`;
}

function CreateError(filepath, error) {
  Error.captureStackTrace(this, this.constructor);
  this.name = this.constructor.name;
  this.message = `Could not create ${filepath}; ${error.toString()}`;
}

util.inherits(CargoExistsError, Error);
util.inherits(CreateError, Error);

module.exports = exportables;
