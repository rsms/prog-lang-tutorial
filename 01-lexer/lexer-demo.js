'use strict';
var Lexer = require('./lib/mylang/Lexer');

var L = Lexer();
L.appendSource('Hello = (ba');
L.appendSource('r baz) ->\n'+
               '  ה = c');
read_tokens(L);
L.appendSource('an-haz [bar \'ba');
L.appendSource('r bara\']\n'+
               '  54');
read_tokens(L);
L.appendSource('.8 * ה\n');
read_tokens(L, true);

// A little demo utility function for reading all tokens from a lexer
function read_tokens(L, source_ended) {
  var tok;
  console.log('read_tokens(L)');
  while ((tok = L.next(source_ended))) {
    console.log(
      'L.next() ->',
      Lexer.TOKEN_NAMES[tok.type],
      tok.value ? require('util').inspect(tok.value) : '-',
      'at', tok.line + ':' + tok.column
    );
  }
}
