// System Objects
import * as util from 'node:util';

// Third Party Dependencies
import npmlog from 'npmlog';
npmlog.level = 'debug';

// "DEBUG ..."
//
// Default: OFF
//
// ALL THE THINGS.
npmlog.addLevel(
	'debug',
	1000,
	{
		fg: 'blue',
	},
	'DEBUG',
);

// "TRACE ..."
//
// Default: OFF
//
// Reserved for more noisy debugging logs/output.
npmlog.addLevel(
	'trace',
	2000,
	{
		fg: 'blue',
	},
	'TRACE',
);

// "    ..."
// No text prefix displayed.
// Use for lists of things.
npmlog.addLevel(
	'basic',
	3000,
	{
		fg: 'white',
	},
	'',
);

// "INFO ..."
// use to display information that describes
// the process being executed or any useful output that
// the end developer may benefit from knowing.
npmlog.addLevel(
	'info',
	3000,
	{
		fg: 'grey',
	},
	'INFO',
);

// "HTTP ..."
// Currently unused, but should be used to indicate
// any HTTP requests being made on behalf of the CLI
npmlog.addLevel(
	'http',
	4000,
	{
		fg: 'grey',
	},
	'HTTP',
);

// "WARN ..."
// Indicates potentially harmful situations
//
npmlog.addLevel(
	'warn',
	5000,
	{
		fg: 'black',
		bg: 'yellow',
	},
	'WARN',
);

//
// "ERR! ..."
// Indicates failure
//
npmlog.addLevel(
	'error',
	6000,
	{
		fg: 'red',
		bg: 'black',
	},
	'ERR!',
);

npmlog.level = 'basic';

Object.defineProperty(npmlog, 'heading', {
	set(value) {
		// jshint ignore:line
		// This strange code is necessary to prevent
		// node-pre-gyp from setting the npmlog.heading
		// property.
		//
		// There exists a rare case in ./lib/usb-connection.js
		// where a third party dependency (usb) is loaded _after_ the
		// internal dependencies.
		//
		//  log -> npmlog
		//
		//  usb -> node-pre-gyp -> npmlog
		//
		// Then node-pre-gyp sets:
		//
		//  npmlog.heading = 'node-pre-gyp';
		//
		// And since our version of npmlog is the same
		// as their version of npmlog, and is literally
		// the same object reference, our version of npmlog
		// starts spitting out log lines that start with
		// "node-pre-gyp".
		//
		// See: https://i.gyazo.com/6c717d3262ba2d7fec8512d735b8af25.png
		//
		// So, by paving over npmlog.heading with a setter that does nothing
		// and getter that returns nothing, we prevent node-pre-gyp
		// from messing up UI of our CLI tool.
	},
	get() {},
});

// Internal
let disabled = false;

const flags = {
	spinner: true,
	debug: true,
	trace: true,
	basic: true,
	info: true,
	http: true,
	warn: true,
	error: true,
};

export function charSpinner(options) {
	options = options || {};
	const cleanup =
		typeof options.cleanup !== 'undefined' ? options.cleanup : true;
	const ms = typeof options.ms !== 'undefined' ? options.ms : 50;
	// '▏▎▍▌▋▊▉█'?
	const sprite = (
		typeof options.sprite !== 'undefined' ? options.sprite : '-\\|/'
	).split('');
	const stream =
		typeof options.stream !== 'undefined' ? options.stream : process.stderr;

	const CARRIAGE_RETURN = stream.isTTY ? '\x1B[0G' : '\r';
	const CLEAR = stream.isTTY ? '\x1B[2K' : '\r \r';

	let index = 0;
	let wrote = false;
	let delay = typeof options.delay !== 'undefined' ? options.delay : 2;
	let interval = setInterval(() => {
		if (--delay >= 0) {
			return;
		}
		index = ++index % sprite.length;
		stream.write(`${sprite[index]}${CARRIAGE_RETURN}`);
		wrote = true;
	}, ms);

	/* istanbul ignore else */
	if (cleanup) {
		process.on('exit', () => {
			/* istanbul ignore else */
			if (wrote) {
				stream.write(CLEAR);
			}
		});
	}

	exports.charSpinner.clear = () => {
		stream.write(CLEAR);
		exports.charSpinner.clear = null;
	};

	return interval;
}

export const spinner = {
	interval: null,
	start() {
		// When there is an active spinner, or spinners are
		// disabled, return immediately.
		if (spinner.interval !== null || disabled || isDisabled('spinner')) {
			return;
		}
		spinner.interval = charSpinner();
	},

	stop() {
		if (spinner.interval !== null) {
			clearInterval(spinner.interval);
			spinner.interval = null;
		}

		if (charSpinner.clear) {
			charSpinner.clear();
		}
	},
};

// Set a logging level
export function level(level) {
	if (level) {
		npmlog.level = level;
	} else {
		return npmlog.level;
	}
}
// Enable or disable ALL logging.
export function disable() {
	disabled = true;
}
export function enable() {
	disabled = false;
}
// Configure logging flags
export function configure(uFlags) {
	if (typeof uFlags !== 'object' || uFlags === null) {
		throw new Error('Invalid log level configuration flags');
	}
	Object.assign(flags, uFlags);
}
export function isEnabled(flag) {
	return flags[flag] === true;
}

export function isDisabled(flag) {
	return flags[flag] === false;
}

export function debug(...args: any[]) {
	const level = 'debug';
	if (false || disabled || exports.isDisabled(level)) {
		return;
	}
	npmlog[level]('', util.format.apply(util, args));
}
export function trace(...args: any[]) {
	const level = 'trace';
	if (false || disabled || exports.isDisabled(level)) {
		return;
	}
	npmlog[level]('', util.format.apply(util, args));
}
export function basic(...args: any[]) {
	const level = 'basic';
	if (false || disabled || exports.isDisabled(level)) {
		return;
	}
	npmlog[level]('', util.format.apply(util, args));
}
export function info(...args: any[]) {
	const level = 'info';
	if (false || disabled || exports.isDisabled(level)) {
		return;
	}
	npmlog[level]('', util.format.apply(util, args));
}
export function http(...args: any[]) {
	const level = 'http';
	if (false || disabled || exports.isDisabled(level)) {
		return;
	}
	npmlog[level]('', util.format.apply(util, args));
}
export function warn(...args: any[]) {
	const level = 'warn';
	if (false || disabled || exports.isDisabled(level)) {
		return;
	}
	npmlog[level]('', util.format.apply(util, args));
}
export function error(...args: any[]) {
	const level = 'error';
	if (false || disabled || exports.isDisabled(level)) {
		return;
	}
	npmlog[level]('', util.format.apply(util, args));
}
