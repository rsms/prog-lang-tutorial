'use strict';
//
// Incremental lexical analyzer
//
// Appending source and reading of tokens is independend and can be paused or
// resumed at any time. Example:
//
//   L = Lexer();
//   L.appendSource("one [two th");
//   L.next();     // -> "one"
//   L.next();     // -> "["
//   L.next();     // -> "two"
//   L.next();     // -> null
//   L.appendSource("ree] fou");
//   L.next();     // -> "three"
//   L.appendSource("r five");
//   L.next();     // -> "]"
//   L.next();     // -> "four"
//   L.next(true); // -> "five"
//   L.next();     // -> null
//
// This is useful when parsing from a streaming source, such as a file on disk
// or data arriving over a network.
//
var UC = require('./unicode');

// Create a new Lexer object.
function Lexer() {
  return Object.create(Lexer.prototype, {
    // List of queued source chunks. A singly-linked list.
    source:            {value: null, enumerable: true, writable: true},
    sourceTail:        {value: null, enumerable: true, writable: true},
    // Offset into source head where we are currently reading
    sourceOffset:      {value: 0,    enumerable: true, writable: true},
    
    // Current source location (counters)
    tokenOffset:       {value: 0,    enumerable: true, writable: true},
    tokenLine:         {value: 0,    enumerable: true, writable: true},
    tokenColumn:       {value: 0,    enumerable: true, writable: true},

    // A token which we are currently reading
    token:             {value: null, enumerable: true, writable: true},
    // Offset into source head where the current value begins
    tokenValueOffset: {value: -1,   enumerable: true, writable: true},
  });
}
module.exports = exports = Lexer;

// A map from Unicode codepoint to token type, for tokens that are single
// characters and can appear anywhere, even terminate other tokens by i.e.
// appearing "inside". E.g. "foo:bar" where ":" is a single-character token
// Would yield three tokens "foo", ":" and "bar".
var SINGLE_TOKENS = {};

// A map from token ID to token name, primarily for debugging
exports.TOKEN_NAMES = {};

// Utility function for defining our tokens
var next_tok_id = 0;
function deftok(name, single_char) {
  var id = Lexer[name] = next_tok_id++;
  exports.TOKEN_NAMES[id] = name;
  if (single_char) {
    SINGLE_TOKENS[single_char.charCodeAt(0)] = id;
  }
  return id;
}

// Let's define our tokens and assign them to convenient local variables
var LINE                 = deftok('LINE');
var LEFT_PAREN           = deftok('LEFT_PAREN',           '(');
var RIGHT_PAREN          = deftok('RIGHT_PAREN',          ')');
var LEFT_SQUARE_BRACKET  = deftok('LEFT_SQUARE_BRACKET',  '[');
var RIGHT_SQUARE_BRACKET = deftok('RIGHT_SQUARE_BRACKET', ']');
var LEFT_CURLY_BRACKET   = deftok('LEFT_CURLY_BRACKET',   '{');
var RIGHT_CURLY_BRACKET  = deftok('RIGHT_CURLY_BRACKET',  '}');
var FULL_STOP            = deftok('FULL_STOP',            '.');
var COLON                = deftok('COLON',                ':');
var DECIMAL_NUMBER       = deftok('DECIMAL_NUMBER');
var HEX_NUMBER           = deftok('HEX_NUMBER');
var FRACTIONAL_NUMBER    = deftok('FRACTIONAL_NUMBER');
var SYMBOL               = deftok('SYMBOL');
var TEXT                 = deftok('TEXT');

// True if Unicode character `c` is a valid symbol character
function is_symbol_character(c) {
  return (c > 0x0020                  // Not a control character
       && c !== UC.REVERSE_SOLIDUS    // Not \
       && !(c > 0x007E && c < 0x00A1) // DEL, control/ws Latin-1 suppl.
       && !UC.is_whitespace(c)        // Not whitespace
       && !(c in SINGLE_TOKENS)       // Not a "single-character token"
  );
}

Lexer.prototype = {

  // Add input source.
  // The `chunk` object need to have the following properties:
  //
  //  .charCodeAt(N)   A function that return the Unicode character value at
  //                   position N, or a NaN if N is out of bounds.
  //
  //  .substring(A, B) A function that returns another chunk object that
  //                   represents the Unicode characters in the range [A,B)
  //
  appendSource: function (chunk) {
    var chunk = {value:chunk, next:null};
    if (this.source === null) {
      this.source = chunk;
    } else {
      this.sourceTail.next = chunk;
    }
    this.sourceTail = chunk;
  },

  // Create a new token of `type` based on the internal source location state
  makeToken: function (type) {
    return {
      // Type of token
      type: type,

      // Value of the token. When a token is being read by the Lexer, this is
      // undefined until returned unless the token spans over multiple source
      // chunks in which case this is used as a source buffer.
      //value: undefined,

      // Virtual location of the token
      offset: this.tokenOffset,
      line:   this.tokenLine,
      column: this.tokenColumn,
    };
  },

  // Returns the current token and clears the "reading token" state. This is
  // an appropriate place to perform some post processing on tokens before
  // they are returned to the caller of `next()`. If `terminated_by_eos` is
  // true, the token was terminated by end of source.
  flushToken: function (terminated_by_eos) {
    var token = this.token;
    this.token = null;

    // TODO: if (token.type === TEXT_LITERAL && terminated_by_eos) throw error

    if (token.type === LINE) {
      // Line tokens have a special kind of value which is the number of spaces
      // which occured after the linebreak. "-1" is to subtract the actual
      // linebreak.
      token.value = this.tokenOffset - token.offset - 1;

    } else if (this.tokenValueOffset !== -1) {
      // The token's value lives in the current source. Copy the interesting
      // substring into .value.
      token.value = this.source.value.substring(
        this.tokenValueOffset,
        this.sourceOffset
      );
      this.tokenValueOffset = -1;
    }

    return token;
  },

  // Reads the next token. If `source_ended` is true, then no more source is
  // expected to arrive and thus EOS acts as a token terminator.
  next: function (source_ended) {
    var c, token;

    while (this.source !== null) {
      // This branch is executed once for each source chunk.

      while (!isNaN(c = this.source.value.charCodeAt(this.sourceOffset))) {
        // This branch is executed once for each source character.
        //console.log('>>', UC.repr(c), "'"+ String.fromCharCode(c) +"'");

        // Now, depending on what we are currently reading we take one of
        // several branches.
        if (this.token === null) {
          // We are not reading any token. This means that we are in a "normal"
          // state and might begin to read certain tokens depending on the
          // character `c`.

          // First, let's handle any single-character tokens in our language
          if ((token = SINGLE_TOKENS[c])) {
            // Simply fall through and let the outer logic return `token` after
            // source counters have been updated.
            token = this.makeToken(token);

          } else {
            // The character `c` is not a single token, so it has to be the
            // beginning of something else. The order of these tests matter,
            // since for instance "3" is a valid symbol character but also a
            // valid number literal character. Since a number literal is a
            // subset of a symbol, we need to test for number literals before
            // we test for symbols.

            if (c === UC.LINE_FEED) { // LINE FEED
              // Beginning of a LINE token
              this.token = this.makeToken(LINE);
              // Note that we don't set this.tokenValueOffset since the value
              // of a line token is the number of spaces which are derived
              // (when the token ends) rather than collected.

              // Since this is a linebreak we need to increment the line counter
              // and reset the column counter. We set `tokenColumn` to -1
              // because right after we are done here and fall through,
              // `tokenColumn` is incremented as part of the source location
              // counter increment.
              ++this.tokenLine;
              this.tokenColumn = -1;

            } else if (c === UC.APOSTROPHE) {
              // Beginning of a text literal
              this.token = this.makeToken(TEXT);
              this.tokenValueOffset = this.sourceOffset;
            
            } else if (UC.is_decdigit(c)) {
              // Beginning of a number literal
              this.token = this.makeToken(DECIMAL_NUMBER);
              this.tokenValueOffset = this.sourceOffset;

            } else if (is_symbol_character(c)) {
              // Beginning of a symbol
              this.token = this.makeToken(SYMBOL);
              this.tokenValueOffset = this.sourceOffset;

            } else if (UC.is_whitespace(c)) {
              // Whitespace between tokens is ignored in our language. This
              // includes various linebreaks as well as control non-printing
              // characters and spaces.
              //
              // However, since we care about lines, and the number of leading
              // spaces of a line, we need to handle the case where the first
              // source line has leading space but is not preceeded by a
              // linebreak. The solution is rather simple:
              if (this.sourceOffset === 0) {
                this.token = this.makeToken(LINE);
              }

            } else {
              throw new Error('Unexpected character ' + UC.repr(c));
            }
          }

        } else {
          // We are currently reading a token, so let's jump to a specific
          // branch used to read subsequent characters for that token type.
          switch (this.token.type) {


          case SYMBOL: {
            // As a symbol token can be terminated by a large number of
            // characters and also contain a large number of characters, there's
            // no easy way to terminate a symbol token.
            if (is_symbol_character(c)) {
              // The current character is part of the current symbol.

              // If the token is buffered, append the character
              if (this.tokenValueOffset === -1) {
                this.token.value += String.fromCharCode(c);
              }
            } else {
              // Symbol token ended.
              // We return the token immediately since otherwise we will eat the
              // current character, which caused this token to be terminated
              // (and thus the character is part of the next token.)
              return this.flushToken();
            }
            break;
          } // case SYMBOL


          case DECIMAL_NUMBER: {
            // A number literal lways begins with a decimal digit but might
            // continue on one of several branches:
            // NN ... same branch
            // N. ... with fractions
            // 0x ... hexadecimal

            if (c === UC.SMALL_LETTER_X) {
              // Hexadecimal has a requirement on the first character being "0",
              // so let's verify that when we get a "x" character.
              if ((this.tokenValueOffset !== -1 &&
                   (this.tokenValueOffset !== this.sourceOffset-1 ||
                    this.source.value.charCodeAt(this.tokenValueOffset) !==
                      UC.DIGIT_ZERO)
                  ) ||
                  (this.tokenValueOffset === -1 &&
                   (this.token.value.length !== 1 ||
                    this.token.value.charCodeAt(0) !== DIGIT_ZERO)
                  )
                 ) {
                // "x" can't appear anywhere but after the initial "0"
                throw new Error(
                  'Syntax error: Unexpected "x" in number literal'
                );
              } else {
                this.token.type = HEX_NUMBER;
              }
            } else if (c === UC.FULL_STOP) {
              this.token.type = FRACTIONAL_NUMBER;

            } else if (!UC.is_decdigit(c)) {
              // c is not a decimal digit. This terminates our token.
              return this.flushToken();
            }

            // If the token is buffered, append the character
            if (this.tokenValueOffset === -1) {
              this.token.value += String.fromCharCode(c);
            }

            break;
          } // case NUMBER


          case HEX_NUMBER: {
            // A hexadecimal number literal: "0x" (0..9 | A..F | a..f)+. When we
            // are in this branch, we have already passed "0x", so all we need
            // to do is end out token when we encounter a non-hex digit.
            if (UC.is_hexdigit(c)) {
              // If the token is buffered, append the character
              if (this.tokenValueOffset === -1) {
                this.token.value += String.fromCharCode(c);
              }
            } else {
              // Hex number literal token ended
              return this.flushToken();
            }
            break;
          }


          case FRACTIONAL_NUMBER: {
            // A fractional number literal is the most complex of the number
            // literals in our language. For simplicity sake we will leave the
            // semantics of the sequence to the consumer of the Lexer and simply
            // look for a terminating character.
            // FRACTIONAL_DIGIT = "." | "+" | "E" | "e" | 0..9
            if (c === UC.FULL_STOP ||
                c === UC.PLUS_SIGN ||
                c === UC.CAPITAL_LETTER_E ||
                c === UC.SMALL_LETTER_E ||
                UC.is_decdigit(c)) {
              // If the token is buffered, append the character
              if (this.tokenValueOffset === -1) {
                this.token.value += String.fromCharCode(c);
              }
            } else {
              // Line token ended
              return this.flushToken();
            }
            break;
          }


          case TEXT: {
            // A text literal is enclosed in APOSTROPHE characters. An
            // APOSTROPHE character and a number of "special" characters might
            // occur in the string, escaped with a leading REVERSE_SOLIDUS "\".

            throw new Error('Lesson 1: Implement reading of Text tokens');
            
            break;
          }


          case LINE: {
            // A line token has [0-Inf) space characters following the linebreak
            if (!UC.is_space(c)) {
              // Line token ended
              return this.flushToken();
            }
            break;
          } // case LINE


          default: {
            // Oops. We forgot to "case" a token type.
            throw new Error('Unexpected token type ' + this.token.type);
            break;
          }

          } // switch this.token.type

        } // if (this.token === null)

        // Increment source counters and advance input
        ++this.sourceOffset;
        ++this.tokenOffset;
        ++this.tokenColumn;

        // If we have a token to return, this is the time
        if (token !== undefined) {
          return token;
        }

      } // while (c)

      // If we get here, that means this.source ended.

      // Are we currently interested in something inside the source chunk, which
      // we are about to discard, and it's spanning across source chunks w/o
      // being buffered?
      if (this.tokenValueOffset !== -1) {
        this.token.value = this.source.value.substring(this.tokenValueOffset);
        this.tokenValueOffset = -1;
      }

      // Throw away the used source by assigning the next source chunk. Also
      // reset the source's offset.
      this.source = this.source.next;
      if (this.source === null) {
        this.sourceTail = null;
      }
      this.sourceOffset = 0;

    } // while this.source

    // If we get here, that means there's no more source. We indicate this by
    // returning the null atom.

    // However, if `source_ended` is true, that means there will be no more
    // source, so if we are currently parsing a token which can be terminated by
    // EOS, return it.
    if (source_ended && this.token !== null) {
      return this.flushToken(source_ended);

    } else {
      return null;
    }
  },

};

if (Object.freeze) {
  Object.freeze(Lexer.prototype);
  Object.freeze(exports);
}
