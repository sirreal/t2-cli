// System Objects
// ...

// Third Party Dependencies
// ...

// Internal
import commands from './commands.ts';
import Tessel from './tessel.ts';

export function registerMethods(Tessel) {
	/*
 Reboots Tessel
 */
	Tessel.prototype.reboot = function () {
		var p1 = this.simpleExec(commands.reboot());

		// Using --lan will resolve the Promise but --usb will not. If more than 2 seconds, just resolve timeout i.e. "fire and forget"
		var p2 = new Promise((resolve) => {
			return setTimeout(resolve, 2000);
		});

		return Promise.race([p1, p2]);
	};
}
