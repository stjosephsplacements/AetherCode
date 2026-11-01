import { editorLanguage, languageName } from "./utils";

/** A language an author may offer, as the question bank lists it (GET /question-bank/v1/languages). */
export type Language = { key: string; name: string; editor: string };

/** A language's display name: the service's, else the console's own for a key the service no longer lists. */
export const nameOf = (languages: Language[], key: string): string => languages.find((language) => language.key === key)?.name ?? languageName(key);

/** The code editor's syntax mode for a language key. */
export const editorModeOf = (languages: Language[], key: string): string => languages.find((language) => language.key === key)?.editor ?? editorLanguage(key);
