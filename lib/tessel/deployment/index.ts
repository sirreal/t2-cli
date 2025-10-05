// System Objects
import * as path from 'node:path';

// Third Party Dependencies
import * as fs from 'fs-extra';

import * as js from './javascript.ts';
import * as py from './python.ts';
import * as rs from './rust.ts';

var languages = {
	js,
	py,
	rs,
};

export function resolveLanguage(input) {
	input = String(input).toLowerCase();

	var extname = path.extname(input).slice(1);

	for (var key in languages) {
		var lang = languages[key];
		var meta = lang.meta;

		if (
			input === meta.name ||
			input === meta.extname ||
			extname === meta.name ||
			extname === meta.extname
		) {
			return lang;
		} else {
			if (fs.existsSync(meta.configuration)) {
				return lang;
			}
		}
	}
	return null;
}

export { js, py, rs };
