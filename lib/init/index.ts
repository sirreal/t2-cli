// System Objects
import * as path from 'node:path';

// Third Party Dependencies

// Internal
import * as log from '../log.ts';
import javascript from './javascript.ts';
import rust from './rust.ts';
import python from './python.ts';

export const languages = {
	js: javascript,
	rs: rust,
	py: python,
};

// Initialize the directory given the various options
export const createNewProject = (options) => {
	// Stop spinner from being in our way while entering package.json data
	log.spinner.stop();

	// Set a default directory if one was not provided
	options.directory = options.directory || path.resolve('.');

	// Detect the requested language
	var lang = resolveLanguage(options.lang);

	// If a language could not be detected
	if (lang === null) {
		return Promise.reject(new Error('Unrecognized language selection.'));
	} else {
		// Otherwise generate a project in that language
		return lang.generateProject(options);
	}
};

// Determine the langauge to initialize the project with
export const resolveLanguage = (input) => {
	// If somehow a language option wasn't provided
	if (!input) {
		return languages.js;
	}

	input = input.toLowerCase();

	// If the shorthand "extension" name was used...
	if (languages[input]) {
		return languages[input];
	}

	// ...Otherwise look in the languages[ext].meta.keywords list.
	for (var key in languages) {
		// Pull out the language info
		var lang = languages[key];

		if (lang.meta.keywords && lang.meta.keywords.indexOf(input) !== -1) {
			return lang;
		}
	}

	// If not, someone has requested a language that is not supported
	return null;
};
