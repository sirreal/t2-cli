import * as dns from 'node:dns';

export const CRASH_REPORTER_HOSTNAME = 'crash-reporter.tessel.io';
export const BUILDS_HOSTNAME = 'builds.tessel.io';
export const PACKAGES_HOSTNAME = 'packages.tessel.io';
export const RUSTCC_HOSTNAME = 'rustcc.tessel.io';

export function ifReachable(url) {
	return new Promise((resolve, reject) => {
		dns.lookup(url, (error) => {
			if (error) {
				reject(new Error('This operation requires an internet connection'));
			} else {
				resolve();
			}
		});
	});
}
