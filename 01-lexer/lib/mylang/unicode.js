'use strict';

// Some common Unicode characters
exports.LINE_FEED                                             = 0x000A;
exports.QUOTATION_MARK                                        = 0x0022;
exports.APOSTROPHE                                            = 0x0027;
exports.PLUS_SIGN                                             = 0x002B;
exports.FULL_STOP                                             = 0x002E;
exports.DIGIT_ZERO                                            = 0x0030;
exports.CAPITAL_LETTER_E                                      = 0x0045;
exports.REVERSE_SOLIDUS                                       = 0x005C; // "\"
exports.SMALL_LETTER_E                                        = 0x0065;
exports.SMALL_LETTER_X                                        = 0x0078;

// Returns true if Unicode character code `c` causes space between characters
function is_space(c) {
  return (c === 0x0009 // CHARACTER TABULATION
       || c === 0x0020 // SPACE
       || c === 0x00A0 // NO-BREAK SPACE
       || c === 0x180E // MONGOLIAN VOWEL SEPARATOR

       || (c > 0x1fff && c < 0x200C)
       // Any of: EN QUAD, EM QUAD, EN SPACE, EM SPACE, THREE-PER-EM SPACE,
       // FOUR-PER-EM SPACE, SIX-PER-EM SPACE, FIGURE SPACE, PUNCTUATION SPACE,
       // THIN SPACE, HAIR SPACE and ZERO WIDTH SPACE

       || c === 0x202F // NARROW NO-BREAK SPACE
       || c === 0x205F // MEDIUM MATHEMATICAL SPACE
       || c === 0x3000 // IDEOGRAPHIC SPACE
       || c === 0xFEFF // ZERO WIDTH NO-BREAK SPACE
  );
}
exports.is_space = is_space;

// True if Unicode character code `c` causes lines to break
function is_linebreak(c) {
  return ((c > 0x0009 && c < 0x000E) // LINE FEED .. CARRIAGE RETURN
       || c === 0x0085 // NEXT LINE
       || c === 0x2028 // LINE SEPARATOR
       || c === 0x2029 // PARAGRAPH SEPARATOR
  );
}
exports.is_linebreak = is_linebreak;

// True if Unicode character code `c` causes any kind of whitespace
exports.is_whitespace = function (c) {
  return is_space(c) || is_linebreak(c);
};

// True if Unicode character code `c` is a decimal digit
exports.is_decdigit = function (c) {
  return (c > 0x002F && c < 0x003A);
};

// True if Unicode character code `c` is a hexadecimal digit
exports.is_hexdigit = function (c) {
  return ((c > 0x002F && c < 0x003A) // 0-9
       || (c > 0x0040 && c < 0x0047) // A-F
       || (c > 0x0060 && c < 0x0067) // a-f
  );
};

// Returns a Unicode representation for character code `c`, e.g. "U+00AB"
exports.repr = function (c) {
  return 'U+' +
    (c > 0xfff ? '' : c > 0xff ? '0' : c > 0xf ? '00' : '000') +
    c.toString(16);
};

Object.freeze && Object.freeze(exports);
