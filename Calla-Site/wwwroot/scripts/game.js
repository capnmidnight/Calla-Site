/**
 * https://github.com/csnover/TraceKit
 * @license MIT
 * @namespace TraceKit
 */
(function(window, undefined) {
if (!window) {
    return;
}

var TraceKit = {};
var _oldTraceKit = window.TraceKit;

// global reference to slice
var _slice = [].slice;
var UNKNOWN_FUNCTION = '?';

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error#Error_types
var ERROR_TYPES_RE = /^(?:[Uu]ncaught (?:exception: )?)?(?:((?:Eval|Internal|Range|Reference|Syntax|Type|URI|)Error): )?(.*)$/;

/**
 * A better form of hasOwnProperty<br/>
 * Example: `_has(MainHostObject, property) === true/false`
 *
 * @param {Object} object to check property
 * @param {string} key to check
 * @return {Boolean} true if the object has the key and it is not inherited
 */
function _has(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
}

/**
 * Returns true if the parameter is undefined<br/>
 * Example: `_isUndefined(val) === true/false`
 *
 * @param {*} what Value to check
 * @return {Boolean} true if undefined and false otherwise
 */
function _isUndefined(what) {
    return typeof what === 'undefined';
}

/**
 * Export TraceKit out to another variable<br/>
 * Example: `var TK = TraceKit.noConflict()`
 * @return {Object} The TraceKit object
 * @memberof TraceKit
 */
TraceKit.noConflict = function noConflict() {
    window.TraceKit = _oldTraceKit;
    return TraceKit;
};

/**
 * Wrap any function in a TraceKit reporter<br/>
 * Example: `func = TraceKit.wrap(func);`
 *
 * @param {Function} func Function to be wrapped
 * @return {Function} The wrapped func
 * @memberof TraceKit
 */
TraceKit.wrap = function traceKitWrapper(func) {
    function wrapped() {
        try {
            return func.apply(this, arguments);
        } catch (e) {
            TraceKit.report(e);
            throw e;
        }
    }
    return wrapped;
};

/**
 * Cross-browser processing of unhandled exceptions
 *
 * Syntax:
 * ```js
 *   TraceKit.report.subscribe(function(stackInfo) { ... })
 *   TraceKit.report.unsubscribe(function(stackInfo) { ... })
 *   TraceKit.report(exception)
 *   try { ...code... } catch(ex) { TraceKit.report(ex); }
 * ```
 *
 * Supports:
 *   - Firefox: full stack trace with line numbers, plus column number
 *     on top frame; column number is not guaranteed
 *   - Opera: full stack trace with line and column numbers
 *   - Chrome: full stack trace with line and column numbers
 *   - Safari: line and column number for the top frame only; some frames
 *     may be missing, and column number is not guaranteed
 *   - IE: line and column number for the top frame only; some frames
 *     may be missing, and column number is not guaranteed
 *
 * In theory, TraceKit should work on all of the following versions:
 *   - IE5.5+ (only 8.0 tested)
 *   - Firefox 0.9+ (only 3.5+ tested)
 *   - Opera 7+ (only 10.50 tested; versions 9 and earlier may require
 *     Exceptions Have Stacktrace to be enabled in opera:config)
 *   - Safari 3+ (only 4+ tested)
 *   - Chrome 1+ (only 5+ tested)
 *   - Konqueror 3.5+ (untested)
 *
 * Requires TraceKit.computeStackTrace.
 *
 * Tries to catch all unhandled exceptions and report them to the
 * subscribed handlers. Please note that TraceKit.report will rethrow the
 * exception. This is REQUIRED in order to get a useful stack trace in IE.
 * If the exception does not reach the top of the browser, you will only
 * get a stack trace from the point where TraceKit.report was called.
 *
 * Handlers receive a TraceKit.StackTrace object as described in the
 * TraceKit.computeStackTrace docs.
 *
 * @memberof TraceKit
 * @namespace
 */
TraceKit.report = (function reportModuleWrapper() {
    var handlers = [],
        lastException = null,
        lastExceptionStack = null;

    /**
     * Add a crash handler.
     * @param {Function} handler
     * @memberof TraceKit.report
     */
    function subscribe(handler) {
        installGlobalHandler();
        handlers.push(handler);
    }

    /**
     * Remove a crash handler.
     * @param {Function} handler
     * @memberof TraceKit.report
     */
    function unsubscribe(handler) {
        for (var i = handlers.length - 1; i >= 0; --i) {
            if (handlers[i] === handler) {
                handlers.splice(i, 1);
            }
        }

        if (handlers.length === 0) {
            window.onerror = _oldOnerrorHandler;
            _onErrorHandlerInstalled = false;
        }
    }

    /**
     * Dispatch stack information to all handlers.
     * @param {TraceKit.StackTrace} stack
     * @param {boolean} isWindowError Is this a top-level window error?
     * @param {Error=} error The error that's being handled (if available, null otherwise)
     * @memberof TraceKit.report
     * @throws An exception if an error occurs while calling an handler.
     */
    function notifyHandlers(stack, isWindowError, error) {
        var exception = null;
        if (isWindowError && !TraceKit.collectWindowErrors) {
          return;
        }
        for (var i in handlers) {
            if (_has(handlers, i)) {
                try {
                    handlers[i](stack, isWindowError, error);
                } catch (inner) {
                    exception = inner;
                }
            }
        }

        if (exception) {
            throw exception;
        }
    }

    var _oldOnerrorHandler, _onErrorHandlerInstalled;

    /**
     * Ensures all global unhandled exceptions are recorded.
     * Supported by Gecko and IE.
     * @param {string} message Error message.
     * @param {string} url URL of script that generated the exception.
     * @param {(number|string)} lineNo The line number at which the error occurred.
     * @param {(number|string)=} columnNo The column number at which the error occurred.
     * @param {Error=} errorObj The actual Error object.
     * @memberof TraceKit.report
     */
    function traceKitWindowOnError(message, url, lineNo, columnNo, errorObj) {
        var stack = null;

        if (lastExceptionStack) {
            TraceKit.computeStackTrace.augmentStackTraceWithInitialElement(lastExceptionStack, url, lineNo, message);
    	    processLastException();
        } else if (errorObj) {
            stack = TraceKit.computeStackTrace(errorObj);
            notifyHandlers(stack, true, errorObj);
        } else {
            var location = {
              'url': url,
              'line': lineNo,
              'column': columnNo
            };

            var name;
            var msg = message; // must be new var or will modify original `arguments`
            if ({}.toString.call(message) === '[object String]') {
                var groups = message.match(ERROR_TYPES_RE);
                if (groups) {
                    name = groups[1];
                    msg = groups[2];
                }
            }

            location.func = TraceKit.computeStackTrace.guessFunctionName(location.url, location.line);
            location.context = TraceKit.computeStackTrace.gatherContext(location.url, location.line);
            stack = {
                'name': name,
                'message': msg,
                'mode': 'onerror',
                'stack': [location]
            };

            notifyHandlers(stack, true, null);
        }

        if (_oldOnerrorHandler) {
            return _oldOnerrorHandler.apply(this, arguments);
        }

        return false;
    }

    /**
     * Install a global onerror handler
     * @memberof TraceKit.report
     */
    function installGlobalHandler() {
        if (_onErrorHandlerInstalled === true) {
            return;
        }

        _oldOnerrorHandler = window.onerror;
        window.onerror = traceKitWindowOnError;
        _onErrorHandlerInstalled = true;
    }

    /**
     * Process the most recent exception
     * @memberof TraceKit.report
     */
    function processLastException() {
        var _lastExceptionStack = lastExceptionStack,
            _lastException = lastException;
        lastExceptionStack = null;
        lastException = null;
        notifyHandlers(_lastExceptionStack, false, _lastException);
    }

    /**
     * Reports an unhandled Error to TraceKit.
     * @param {Error} ex
     * @memberof TraceKit.report
     * @throws An exception if an incomplete stack trace is detected (old IE browsers).
     */
    function report(ex) {
        if (lastExceptionStack) {
            if (lastException === ex) {
                return; // already caught by an inner catch block, ignore
            } else {
              processLastException();
            }
        }

        var stack = TraceKit.computeStackTrace(ex);
        lastExceptionStack = stack;
        lastException = ex;

        // If the stack trace is incomplete, wait for 2 seconds for
        // slow slow IE to see if onerror occurs or not before reporting
        // this exception; otherwise, we will end up with an incomplete
        // stack trace
        setTimeout(function () {
            if (lastException === ex) {
                processLastException();
            }
        }, (stack.incomplete ? 2000 : 0));

        throw ex; // re-throw to propagate to the top level (and cause window.onerror)
    }

    report.subscribe = subscribe;
    report.unsubscribe = unsubscribe;
    return report;
}());

/**
 * An object representing a single stack frame.
 * @typedef {Object} StackFrame
 * @property {string} url The JavaScript or HTML file URL.
 * @property {string} func The function name, or empty for anonymous functions (if guessing did not work).
 * @property {string[]?} args The arguments passed to the function, if known.
 * @property {number=} line The line number, if known.
 * @property {number=} column The column number, if known.
 * @property {string[]} context An array of source code lines; the middle element corresponds to the correct line#.
 * @memberof TraceKit
 */

/**
 * An object representing a JavaScript stack trace.
 * @typedef {Object} StackTrace
 * @property {string} name The name of the thrown exception.
 * @property {string} message The exception error message.
 * @property {TraceKit.StackFrame[]} stack An array of stack frames.
 * @property {string} mode 'stack', 'stacktrace', 'multiline', 'callers', 'onerror', or 'failed' -- method used to collect the stack trace.
 * @memberof TraceKit
 */

/**
 * TraceKit.computeStackTrace: cross-browser stack traces in JavaScript
 *
 * Syntax:
 *   ```js
 *   s = TraceKit.computeStackTrace.ofCaller([depth])
 *   s = TraceKit.computeStackTrace(exception) // consider using TraceKit.report instead (see below)
 *   ```
 *
 * Supports:
 *   - Firefox:  full stack trace with line numbers and unreliable column
 *               number on top frame
 *   - Opera 10: full stack trace with line and column numbers
 *   - Opera 9-: full stack trace with line numbers
 *   - Chrome:   full stack trace with line and column numbers
 *   - Safari:   line and column number for the topmost stacktrace element
 *               only
 *   - IE:       no line numbers whatsoever
 *
 * Tries to guess names of anonymous functions by looking for assignments
 * in the source code. In IE and Safari, we have to guess source file names
 * by searching for function bodies inside all page scripts. This will not
 * work for scripts that are loaded cross-domain.
 * Here be dragons: some function names may be guessed incorrectly, and
 * duplicate functions may be mismatched.
 *
 * TraceKit.computeStackTrace should only be used for tracing purposes.
 * Logging of unhandled exceptions should be done with TraceKit.report,
 * which builds on top of TraceKit.computeStackTrace and provides better
 * IE support by utilizing the window.onerror event to retrieve information
 * about the top of the stack.
 *
 * Note: In IE and Safari, no stack trace is recorded on the Error object,
 * so computeStackTrace instead walks its *own* chain of callers.
 * This means that:
 *  * in Safari, some methods may be missing from the stack trace;
 *  * in IE, the topmost function in the stack trace will always be the
 *    caller of computeStackTrace.
 *
 * This is okay for tracing (because you are likely to be calling
 * computeStackTrace from the function you want to be the topmost element
 * of the stack trace anyway), but not okay for logging unhandled
 * exceptions (because your catch block will likely be far away from the
 * inner function that actually caused the exception).
 *
 * Tracing example:
 *  ```js
 *     function trace(message) {
 *         var stackInfo = TraceKit.computeStackTrace.ofCaller();
 *         var data = message + "\n";
 *         for(var i in stackInfo.stack) {
 *             var item = stackInfo.stack[i];
 *             data += (item.func || '[anonymous]') + "() in " + item.url + ":" + (item.line || '0') + "\n";
 *         }
 *         if (window.console)
 *             console.info(data);
 *         else
 *             alert(data);
 *     }
 * ```
 * @memberof TraceKit
 * @namespace
 */
TraceKit.computeStackTrace = (function computeStackTraceWrapper() {
    var debug = false,
        sourceCache = {};

    /**
     * Attempts to retrieve source code via XMLHttpRequest, which is used
     * to look up anonymous function names.
     * @param {string} url URL of source code.
     * @return {string} Source contents.
     * @memberof TraceKit.computeStackTrace
     */
    function loadSource(url) {
        if (!TraceKit.remoteFetching) { //Only attempt request if remoteFetching is on.
            return '';
        }
        try {
            var getXHR = function() {
                try {
                    return new window.XMLHttpRequest();
                } catch (e) {
                    // explicitly bubble up the exception if not found
                    return new window.ActiveXObject('Microsoft.XMLHTTP');
                }
            };

            var request = getXHR();
            request.open('GET', url, false);
            request.send('');
            return request.responseText;
        } catch (e) {
            return '';
        }
    }

    /**
     * Retrieves source code from the source code cache.
     * @param {string} url URL of source code.
     * @return {Array.<string>} Source contents.
     * @memberof TraceKit.computeStackTrace
     */
    function getSource(url) {
        if (typeof url !== 'string') {
            return [];
        }

        if (!_has(sourceCache, url)) {
            // URL needs to be able to fetched within the acceptable domain.  Otherwise,
            // cross-domain errors will be triggered.
            /*
                Regex matches:
                0 - Full Url
                1 - Protocol
                2 - Domain
                3 - Port (Useful for internal applications)
                4 - Path
            */
            var source = '';
            var domain = '';
            try { domain = window.document.domain; } catch (e) { }
            var match = /(.*)\:\/\/([^:\/]+)([:\d]*)\/{0,1}([\s\S]*)/.exec(url);
            if (match && match[2] === domain) {
                source = loadSource(url);
            }
            sourceCache[url] = source ? source.split('\n') : [];
        }

        return sourceCache[url];
    }

    /**
     * Tries to use an externally loaded copy of source code to determine
     * the name of a function by looking at the name of the variable it was
     * assigned to, if any.
     * @param {string} url URL of source code.
     * @param {(string|number)} lineNo Line number in source code.
     * @return {string} The function name, if discoverable.
     * @memberof TraceKit.computeStackTrace
     */
    function guessFunctionName(url, lineNo) {
        var reFunctionArgNames = /function ([^(]*)\(([^)]*)\)/,
            reGuessFunction = /['"]?([0-9A-Za-z$_]+)['"]?\s*[:=]\s*(function|eval|new Function)/,
            line = '',
            maxLines = 10,
            source = getSource(url),
            m;

        if (!source.length) {
            return UNKNOWN_FUNCTION;
        }

        // Walk backwards from the first line in the function until we find the line which
        // matches the pattern above, which is the function definition
        for (var i = 0; i < maxLines; ++i) {
            line = source[lineNo - i] + line;

            if (!_isUndefined(line)) {
                if ((m = reGuessFunction.exec(line))) {
                    return m[1];
                } else if ((m = reFunctionArgNames.exec(line))) {
                    return m[1];
                }
            }
        }

        return UNKNOWN_FUNCTION;
    }

    /**
     * Retrieves the surrounding lines from where an exception occurred.
     * @param {string} url URL of source code.
     * @param {(string|number)} line Line number in source code to center around for context.
     * @return {?Array.<string>} Lines of source code.
     * @memberof TraceKit.computeStackTrace
     */
    function gatherContext(url, line) {
        var source = getSource(url);

        if (!source.length) {
            return null;
        }

        var context = [],
            // linesBefore & linesAfter are inclusive with the offending line.
            // if linesOfContext is even, there will be one extra line
            //   *before* the offending line.
            linesBefore = Math.floor(TraceKit.linesOfContext / 2),
            // Add one extra line if linesOfContext is odd
            linesAfter = linesBefore + (TraceKit.linesOfContext % 2),
            start = Math.max(0, line - linesBefore - 1),
            end = Math.min(source.length, line + linesAfter - 1);

        line -= 1; // convert to 0-based index

        for (var i = start; i < end; ++i) {
            if (!_isUndefined(source[i])) {
                context.push(source[i]);
            }
        }

        return context.length > 0 ? context : null;
    }

    /**
     * Escapes special characters, except for whitespace, in a string to be
     * used inside a regular expression as a string literal.
     * @param {string} text The string.
     * @return {string} The escaped string literal.
     * @memberof TraceKit.computeStackTrace
     */
    function escapeRegExp(text) {
        return text.replace(/[\-\[\]{}()*+?.,\\\^$|#]/g, '\\$&');
    }

    /**
     * Escapes special characters in a string to be used inside a regular
     * expression as a string literal. Also ensures that HTML entities will
     * be matched the same as their literal friends.
     * @param {string} body The string.
     * @return {string} The escaped string.
     * @memberof TraceKit.computeStackTrace
     */
    function escapeCodeAsRegExpForMatchingInsideHTML(body) {
        return escapeRegExp(body).replace('<', '(?:<|&lt;)').replace('>', '(?:>|&gt;)').replace('&', '(?:&|&amp;)').replace('"', '(?:"|&quot;)').replace(/\s+/g, '\\s+');
    }

    /**
     * Determines where a code fragment occurs in the source code.
     * @param {RegExp} re The function definition.
     * @param {Array.<string>} urls A list of URLs to search.
     * @return {?Object.<string, (string|number)>} An object containing
     * the url, line, and column number of the defined function.
     * @memberof TraceKit.computeStackTrace
     */
    function findSourceInUrls(re, urls) {
        var source, m;
        for (var i = 0, j = urls.length; i < j; ++i) {
            if ((source = getSource(urls[i])).length) {
                source = source.join('\n');
                if ((m = re.exec(source))) {

                    return {
                        'url': urls[i],
                        'line': source.substring(0, m.index).split('\n').length,
                        'column': m.index - source.lastIndexOf('\n', m.index) - 1
                    };
                }
            }
        }

        return null;
    }

    /**
     * Determines at which column a code fragment occurs on a line of the
     * source code.
     * @param {string} fragment The code fragment.
     * @param {string} url The URL to search.
     * @param {(string|number)} line The line number to examine.
     * @return {?number} The column number.
     * @memberof TraceKit.computeStackTrace
     */
    function findSourceInLine(fragment, url, line) {
        var source = getSource(url),
            re = new RegExp('\\b' + escapeRegExp(fragment) + '\\b'),
            m;

        line -= 1;

        if (source && source.length > line && (m = re.exec(source[line]))) {
            return m.index;
        }

        return null;
    }

    /**
     * Determines where a function was defined within the source code.
     * @param {(Function|string)} func A function reference or serialized
     * function definition.
     * @return {?Object.<string, (string|number)>} An object containing
     * the url, line, and column number of the defined function.
     * @memberof TraceKit.computeStackTrace
     */
    function findSourceByFunctionBody(func) {
        if (_isUndefined(window && window.document)) {
            return;
        }

        var urls = [window.location.href],
            scripts = window.document.getElementsByTagName('script'),
            body,
            code = '' + func,
            codeRE = /^function(?:\s+([\w$]+))?\s*\(([\w\s,]*)\)\s*\{\s*(\S[\s\S]*\S)\s*\}\s*$/,
            eventRE = /^function on([\w$]+)\s*\(event\)\s*\{\s*(\S[\s\S]*\S)\s*\}\s*$/,
            re,
            parts,
            result;

        for (var i = 0; i < scripts.length; ++i) {
            var script = scripts[i];
            if (script.src) {
                urls.push(script.src);
            }
        }

        if (!(parts = codeRE.exec(code))) {
            re = new RegExp(escapeRegExp(code).replace(/\s+/g, '\\s+'));
        }

        // not sure if this is really necessary, but I don’t have a test
        // corpus large enough to confirm that and it was in the original.
        else {
            var name = parts[1] ? '\\s+' + parts[1] : '',
                args = parts[2].split(',').join('\\s*,\\s*');

            body = escapeRegExp(parts[3]).replace(/;$/, ';?'); // semicolon is inserted if the function ends with a comment.replace(/\s+/g, '\\s+');
            re = new RegExp('function' + name + '\\s*\\(\\s*' + args + '\\s*\\)\\s*{\\s*' + body + '\\s*}');
        }

        // look for a normal function definition
        if ((result = findSourceInUrls(re, urls))) {
            return result;
        }

        // look for an old-school event handler function
        if ((parts = eventRE.exec(code))) {
            var event = parts[1];
            body = escapeCodeAsRegExpForMatchingInsideHTML(parts[2]);

            // look for a function defined in HTML as an onXXX handler
            re = new RegExp('on' + event + '=[\\\'"]\\s*' + body + '\\s*[\\\'"]', 'i');

            if ((result = findSourceInUrls(re, urls[0]))) {
                return result;
            }

            // look for ???
            re = new RegExp(body);

            if ((result = findSourceInUrls(re, urls))) {
                return result;
            }
        }

        return null;
    }

    // Contents of Exception in various browsers.
    //
    // SAFARI:
    // ex.message = Can't find variable: qq
    // ex.line = 59
    // ex.sourceId = 580238192
    // ex.sourceURL = http://...
    // ex.expressionBeginOffset = 96
    // ex.expressionCaretOffset = 98
    // ex.expressionEndOffset = 98
    // ex.name = ReferenceError
    //
    // FIREFOX:
    // ex.message = qq is not defined
    // ex.fileName = http://...
    // ex.lineNumber = 59
    // ex.columnNumber = 69
    // ex.stack = ...stack trace... (see the example below)
    // ex.name = ReferenceError
    //
    // CHROME:
    // ex.message = qq is not defined
    // ex.name = ReferenceError
    // ex.type = not_defined
    // ex.arguments = ['aa']
    // ex.stack = ...stack trace...
    //
    // INTERNET EXPLORER:
    // ex.message = ...
    // ex.name = ReferenceError
    //
    // OPERA:
    // ex.message = ...message... (see the example below)
    // ex.name = ReferenceError
    // ex.opera#sourceloc = 11  (pretty much useless, duplicates the info in ex.message)
    // ex.stacktrace = n/a; see 'opera:config#UserPrefs|Exceptions Have Stacktrace'

    /**
     * Computes stack trace information from the stack property.
     * Chrome and Gecko use this property.
     * @param {Error} ex
     * @return {?TraceKit.StackTrace} Stack trace information.
     * @memberof TraceKit.computeStackTrace
     */
    function computeStackTraceFromStackProp(ex) {
        if (!ex.stack) {
            return null;
        }

        var chrome = /^\s*at (.*?) ?\(((?:file|https?|blob|chrome-extension|native|eval|webpack|<anonymous>|\/).*?)(?::(\d+))?(?::(\d+))?\)?\s*$/i,
            gecko = /^\s*(.*?)(?:\((.*?)\))?(?:^|@)((?:file|https?|blob|chrome|webpack|resource|\[native).*?|[^@]*bundle)(?::(\d+))?(?::(\d+))?\s*$/i,
            winjs = /^\s*at (?:((?:\[object object\])?.+) )?\(?((?:file|ms-appx|https?|webpack|blob):.*?):(\d+)(?::(\d+))?\)?\s*$/i,

            // Used to additionally parse URL/line/column from eval frames
            isEval,
            geckoEval = /(\S+) line (\d+)(?: > eval line \d+)* > eval/i,
            chromeEval = /\((\S*)(?::(\d+))(?::(\d+))\)/,

            lines = ex.stack.split('\n'),
            stack = [],
            submatch,
            parts,
            element,
            reference = /^(.*) is undefined$/.exec(ex.message);

        for (var i = 0, j = lines.length; i < j; ++i) {
            if ((parts = chrome.exec(lines[i]))) {
                var isNative = parts[2] && parts[2].indexOf('native') === 0; // start of line
                isEval = parts[2] && parts[2].indexOf('eval') === 0; // start of line
                if (isEval && (submatch = chromeEval.exec(parts[2]))) {
                    // throw out eval line/column and use top-most line/column number
                    parts[2] = submatch[1]; // url
                    parts[3] = submatch[2]; // line
                    parts[4] = submatch[3]; // column
                }
                element = {
                    'url': !isNative ? parts[2] : null,
                    'func': parts[1] || UNKNOWN_FUNCTION,
                    'args': isNative ? [parts[2]] : [],
                    'line': parts[3] ? +parts[3] : null,
                    'column': parts[4] ? +parts[4] : null
                };
            } else if ( parts = winjs.exec(lines[i]) ) {
                element = {
                    'url': parts[2],
                    'func': parts[1] || UNKNOWN_FUNCTION,
                    'args': [],
                    'line': +parts[3],
                    'column': parts[4] ? +parts[4] : null
                };
            } else if ((parts = gecko.exec(lines[i]))) {
                isEval = parts[3] && parts[3].indexOf(' > eval') > -1;
                if (isEval && (submatch = geckoEval.exec(parts[3]))) {
                    // throw out eval line/column and use top-most line number
                    parts[3] = submatch[1];
                    parts[4] = submatch[2];
                    parts[5] = null; // no column when eval
                } else if (i === 0 && !parts[5] && !_isUndefined(ex.columnNumber)) {
                    // FireFox uses this awesome columnNumber property for its top frame
                    // Also note, Firefox's column number is 0-based and everything else expects 1-based,
                    // so adding 1
                    // NOTE: this hack doesn't work if top-most frame is eval
                    stack[0].column = ex.columnNumber + 1;
                }
                element = {
                    'url': parts[3],
                    'func': parts[1] || UNKNOWN_FUNCTION,
                    'args': parts[2] ? parts[2].split(',') : [],
                    'line': parts[4] ? +parts[4] : null,
                    'column': parts[5] ? +parts[5] : null
                };
            } else {
                continue;
            }

            if (!element.func && element.line) {
                element.func = guessFunctionName(element.url, element.line);
            }

            element.context = element.line ? gatherContext(element.url, element.line) : null;
            stack.push(element);
        }

        if (!stack.length) {
            return null;
        }

        if (stack[0] && stack[0].line && !stack[0].column && reference) {
            stack[0].column = findSourceInLine(reference[1], stack[0].url, stack[0].line);
        }

        return {
            'mode': 'stack',
            'name': ex.name,
            'message': ex.message,
            'stack': stack
        };
    }

    /**
     * Computes stack trace information from the stacktrace property.
     * Opera 10+ uses this property.
     * @param {Error} ex
     * @return {?TraceKit.StackTrace} Stack trace information.
     * @memberof TraceKit.computeStackTrace
     */
    function computeStackTraceFromStacktraceProp(ex) {
        // Access and store the stacktrace property before doing ANYTHING
        // else to it because Opera is not very good at providing it
        // reliably in other circumstances.
        var stacktrace = ex.stacktrace;
        if (!stacktrace) {
            return;
        }

        var opera10Regex = / line (\d+).*script (?:in )?(\S+)(?:: in function (\S+))?$/i,
            opera11Regex = / line (\d+), column (\d+)\s*(?:in (?:<anonymous function: ([^>]+)>|([^\)]+))\((.*)\))? in (.*):\s*$/i,
            lines = stacktrace.split('\n'),
            stack = [],
            parts;

        for (var line = 0; line < lines.length; line += 2) {
            var element = null;
            if ((parts = opera10Regex.exec(lines[line]))) {
                element = {
                    'url': parts[2],
                    'line': +parts[1],
                    'column': null,
                    'func': parts[3],
                    'args':[]
                };
            } else if ((parts = opera11Regex.exec(lines[line]))) {
                element = {
                    'url': parts[6],
                    'line': +parts[1],
                    'column': +parts[2],
                    'func': parts[3] || parts[4],
                    'args': parts[5] ? parts[5].split(',') : []
                };
            }

            if (element) {
                if (!element.func && element.line) {
                    element.func = guessFunctionName(element.url, element.line);
                }
                if (element.line) {
                    try {
                        element.context = gatherContext(element.url, element.line);
                    } catch (exc) {}
                }

                if (!element.context) {
                    element.context = [lines[line + 1]];
                }

                stack.push(element);
            }
        }

        if (!stack.length) {
            return null;
        }

        return {
            'mode': 'stacktrace',
            'name': ex.name,
            'message': ex.message,
            'stack': stack
        };
    }

    /**
     * NOT TESTED.
     * Computes stack trace information from an error message that includes
     * the stack trace.
     * Opera 9 and earlier use this method if the option to show stack
     * traces is turned on in opera:config.
     * @param {Error} ex
     * @return {?TraceKit.StackTrace} Stack information.
     * @memberof TraceKit.computeStackTrace
     */
    function computeStackTraceFromOperaMultiLineMessage(ex) {
        // TODO: Clean this function up
        // Opera includes a stack trace into the exception message. An example is:
        //
        // Statement on line 3: Undefined variable: undefinedFunc
        // Backtrace:
        //   Line 3 of linked script file://localhost/Users/andreyvit/Projects/TraceKit/javascript-client/sample.js: In function zzz
        //         undefinedFunc(a);
        //   Line 7 of inline#1 script in file://localhost/Users/andreyvit/Projects/TraceKit/javascript-client/sample.html: In function yyy
        //           zzz(x, y, z);
        //   Line 3 of inline#1 script in file://localhost/Users/andreyvit/Projects/TraceKit/javascript-client/sample.html: In function xxx
        //           yyy(a, a, a);
        //   Line 1 of function script
        //     try { xxx('hi'); return false; } catch(ex) { TraceKit.report(ex); }
        //   ...

        var lines = ex.message.split('\n');
        if (lines.length < 4) {
            return null;
        }

        var lineRE1 = /^\s*Line (\d+) of linked script ((?:file|https?|blob)\S+)(?:: in function (\S+))?\s*$/i,
            lineRE2 = /^\s*Line (\d+) of inline#(\d+) script in ((?:file|https?|blob)\S+)(?:: in function (\S+))?\s*$/i,
            lineRE3 = /^\s*Line (\d+) of function script\s*$/i,
            stack = [],
            scripts = (window && window.document && window.document.getElementsByTagName('script')),
            inlineScriptBlocks = [],
            parts;

        for (var s in scripts) {
            if (_has(scripts, s) && !scripts[s].src) {
                inlineScriptBlocks.push(scripts[s]);
            }
        }

        for (var line = 2; line < lines.length; line += 2) {
            var item = null;
            if ((parts = lineRE1.exec(lines[line]))) {
                item = {
                    'url': parts[2],
                    'func': parts[3],
                    'args': [],
                    'line': +parts[1],
                    'column': null
                };
            } else if ((parts = lineRE2.exec(lines[line]))) {
                item = {
                    'url': parts[3],
                    'func': parts[4],
                    'args': [],
                    'line': +parts[1],
                    'column': null // TODO: Check to see if inline#1 (+parts[2]) points to the script number or column number.
                };
                var relativeLine = (+parts[1]); // relative to the start of the <SCRIPT> block
                var script = inlineScriptBlocks[parts[2] - 1];
                if (script) {
                    var source = getSource(item.url);
                    if (source) {
                        source = source.join('\n');
                        var pos = source.indexOf(script.innerText);
                        if (pos >= 0) {
                            item.line = relativeLine + source.substring(0, pos).split('\n').length;
                        }
                    }
                }
            } else if ((parts = lineRE3.exec(lines[line]))) {
                var url = window.location.href.replace(/#.*$/, '');
                var re = new RegExp(escapeCodeAsRegExpForMatchingInsideHTML(lines[line + 1]));
                var src = findSourceInUrls(re, [url]);
                item = {
                    'url': url,
                    'func': '',
                    'args': [],
                    'line': src ? src.line : parts[1],
                    'column': null
                };
            }

            if (item) {
                if (!item.func) {
                    item.func = guessFunctionName(item.url, item.line);
                }
                var context = gatherContext(item.url, item.line);
                var midline = (context ? context[Math.floor(context.length / 2)] : null);
                if (context && midline.replace(/^\s*/, '') === lines[line + 1].replace(/^\s*/, '')) {
                    item.context = context;
                } else {
                    // if (context) alert("Context mismatch. Correct midline:\n" + lines[i+1] + "\n\nMidline:\n" + midline + "\n\nContext:\n" + context.join("\n") + "\n\nURL:\n" + item.url);
                    item.context = [lines[line + 1]];
                }
                stack.push(item);
            }
        }
        if (!stack.length) {
            return null; // could not parse multiline exception message as Opera stack trace
        }

        return {
            'mode': 'multiline',
            'name': ex.name,
            'message': lines[0],
            'stack': stack
        };
    }

    /**
     * Adds information about the first frame to incomplete stack traces.
     * Safari and IE require this to get complete data on the first frame.
     * @param {TraceKit.StackTrace} stackInfo Stack trace information from
     * one of the compute* methods.
     * @param {string} url The URL of the script that caused an error.
     * @param {(number|string)} lineNo The line number of the script that
     * caused an error.
     * @param {string=} message The error generated by the browser, which
     * hopefully contains the name of the object that caused the error.
     * @return {boolean} Whether or not the stack information was
     * augmented.
     * @memberof TraceKit.computeStackTrace
     */
    function augmentStackTraceWithInitialElement(stackInfo, url, lineNo, message) {
        var initial = {
            'url': url,
            'line': lineNo
        };

        if (initial.url && initial.line) {
            stackInfo.incomplete = false;

            if (!initial.func) {
                initial.func = guessFunctionName(initial.url, initial.line);
            }

            if (!initial.context) {
                initial.context = gatherContext(initial.url, initial.line);
            }

            var reference = / '([^']+)' /.exec(message);
            if (reference) {
                initial.column = findSourceInLine(reference[1], initial.url, initial.line);
            }

            if (stackInfo.stack.length > 0) {
                if (stackInfo.stack[0].url === initial.url) {
                    if (stackInfo.stack[0].line === initial.line) {
                        return false; // already in stack trace
                    } else if (!stackInfo.stack[0].line && stackInfo.stack[0].func === initial.func) {
                        stackInfo.stack[0].line = initial.line;
                        stackInfo.stack[0].context = initial.context;
                        return false;
                    }
                }
            }

            stackInfo.stack.unshift(initial);
            stackInfo.partial = true;
            return true;
        } else {
            stackInfo.incomplete = true;
        }

        return false;
    }

    /**
     * Computes stack trace information by walking the arguments.caller
     * chain at the time the exception occurred. This will cause earlier
     * frames to be missed but is the only way to get any stack trace in
     * Safari and IE. The top frame is restored by
     * {@link augmentStackTraceWithInitialElement}.
     * @param {Error} ex
     * @return {TraceKit.StackTrace=} Stack trace information.
     * @memberof TraceKit.computeStackTrace
     */
    function computeStackTraceByWalkingCallerChain(ex, depth) {
        var functionName = /function\s+([_$a-zA-Z\xA0-\uFFFF][_$a-zA-Z0-9\xA0-\uFFFF]*)?\s*\(/i,
            stack = [],
            funcs = {},
            recursion = false,
            parts,
            item,
            source;

        for (var curr = computeStackTraceByWalkingCallerChain.caller; curr && !recursion; curr = curr.caller) {
            if (curr === computeStackTrace || curr === TraceKit.report) {
                continue;
            }

            item = {
                'url': null,
                'func': UNKNOWN_FUNCTION,
                'args': [],
                'line': null,
                'column': null
            };

            if (curr.name) {
                item.func = curr.name;
            } else if ((parts = functionName.exec(curr.toString()))) {
                item.func = parts[1];
            }

            if (typeof item.func === 'undefined') {
              try {
                item.func = parts.input.substring(0, parts.input.indexOf('{'));
              } catch (e) { }
            }

            if ((source = findSourceByFunctionBody(curr))) {
                item.url = source.url;
                item.line = source.line;

                if (item.func === UNKNOWN_FUNCTION) {
                    item.func = guessFunctionName(item.url, item.line);
                }

                var reference = / '([^']+)' /.exec(ex.message || ex.description);
                if (reference) {
                    item.column = findSourceInLine(reference[1], source.url, source.line);
                }
            }

            if (funcs['' + curr]) {
                recursion = true;
            }else{
                funcs['' + curr] = true;
            }

            stack.push(item);
        }

        if (depth) {
            stack.splice(0, depth);
        }

        var result = {
            'mode': 'callers',
            'name': ex.name,
            'message': ex.message,
            'stack': stack
        };
        augmentStackTraceWithInitialElement(result, ex.sourceURL || ex.fileName, ex.line || ex.lineNumber, ex.message || ex.description);
        return result;
    }

    /**
     * Computes a stack trace for an exception.
     * @param {Error} ex
     * @param {(string|number)=} depth
     * @memberof TraceKit.computeStackTrace
     */
    function computeStackTrace(ex, depth) {
        var stack = null;
        depth = (depth == null ? 0 : +depth);

        try {
            // This must be tried first because Opera 10 *destroys*
            // its stacktrace property if you try to access the stack
            // property first!!
            stack = computeStackTraceFromStacktraceProp(ex);
            if (stack) {
                return stack;
            }
        } catch (e) {
            if (debug) {
                throw e;
            }
        }

        try {
            stack = computeStackTraceFromStackProp(ex);
            if (stack) {
                return stack;
            }
        } catch (e) {
            if (debug) {
                throw e;
            }
        }

        try {
            stack = computeStackTraceFromOperaMultiLineMessage(ex);
            if (stack) {
                return stack;
            }
        } catch (e) {
            if (debug) {
                throw e;
            }
        }

        try {
            stack = computeStackTraceByWalkingCallerChain(ex, depth + 1);
            if (stack) {
                return stack;
            }
        } catch (e) {
            if (debug) {
                throw e;
            }
        }

        return {
            'name': ex.name,
            'message': ex.message,
            'mode': 'failed'
        };
    }

    /**
     * Logs a stacktrace starting from the previous call and working down.
     * @param {(number|string)=} depth How many frames deep to trace.
     * @return {TraceKit.StackTrace} Stack trace information.
     * @memberof TraceKit.computeStackTrace
     */
    function computeStackTraceOfCaller(depth) {
        depth = (depth == null ? 0 : +depth) + 1; // "+ 1" because "ofCaller" should drop one frame
        try {
            throw new Error();
        } catch (ex) {
            return computeStackTrace(ex, depth + 1);
        }
    }

    computeStackTrace.augmentStackTraceWithInitialElement = augmentStackTraceWithInitialElement;
    computeStackTrace.computeStackTraceFromStackProp = computeStackTraceFromStackProp;
    computeStackTrace.guessFunctionName = guessFunctionName;
    computeStackTrace.gatherContext = gatherContext;
    computeStackTrace.ofCaller = computeStackTraceOfCaller;
    computeStackTrace.getSource = getSource;

    return computeStackTrace;
}());

/**
 * Extends support for global error handling for asynchronous browser
 * functions. Adopted from Closure Library's errorhandler.js
 * @memberof TraceKit
 */
TraceKit.extendToAsynchronousCallbacks = function () {
    var _helper = function _helper(fnName) {
        var originalFn = window[fnName];
        window[fnName] = function traceKitAsyncExtension() {
            // Make a copy of the arguments
            var args = _slice.call(arguments);
            var originalCallback = args[0];
            if (typeof (originalCallback) === 'function') {
                args[0] = TraceKit.wrap(originalCallback);
            }
            // IE < 9 doesn't support .call/.apply on setInterval/setTimeout, but it
            // also only supports 2 argument and doesn't care what "this" is, so we
            // can just call the original function directly.
            if (originalFn.apply) {
                return originalFn.apply(this, args);
            } else {
                return originalFn(args[0], args[1]);
            }
        };
    };

    _helper('setTimeout');
    _helper('setInterval');
};

//Default options:
if (!TraceKit.remoteFetching) {
    TraceKit.remoteFetching = true;
}
if (!TraceKit.collectWindowErrors) {
    TraceKit.collectWindowErrors = true;
}
if (!TraceKit.linesOfContext || TraceKit.linesOfContext < 1) {
    // 5 lines before, the offending line, 5 lines after
    TraceKit.linesOfContext = 11;
}

// UMD export
if (typeof define === 'function' && define.amd) {
    define('TraceKit', [], TraceKit);
} else if (typeof module !== 'undefined' && module.exports && window.module !== module) {
    module.exports = TraceKit;
} else {
    window.TraceKit = TraceKit;
}

}(typeof window !== 'undefined' ? window : global));

(function(){
var keepTrying = true;
TraceKit.report.subscribe((err) => {
    if(keepTrying){
        try{
            err.userAgent = navigator.userAgent;
            const xhr = new XMLHttpRequest();
            xhr.onerror = function() { keepTrying = false; };
            xhr.open("POST", "/ErrorLog");
            xhr.setRequestHeader("Content-Type", "application/json");
            xhr.send(JSON.stringify(err));
        }
        catch(exp){
            keepTrying = false;
        }
    }
});
})();
try{

/**
 * Empties out an array
 * @param {any[]} arr - the array to empty.
 * @returns {any[]} - the items that were in the array.
 */
function arrayClear(arr) {
    if (!(arr instanceof Array)) {
        throw new Error("Must provide an array as the first parameter.");
    }
    return arr.splice(0);
}

/**
 * Removes an item at the given index from an array.
 * @param {any[]} arr
 * @param {number} idx
 * @returns {any} - the item that was removed.
 */
function arrayRemoveAt(arr, idx) {
    if (!(arr instanceof Array)) {
        throw new Error("Must provide an array as the first parameter.");
    }
    return arr.splice(idx, 1);
}

/**
 * A test for filtering an array
 * @callback scanArrayCallback
 * @param {any} obj - an array item to check.
 * @param {number} idx - the index of the item that is being checked.
 * @param {any[]} arr - the full array that is being filtered.
 * @returns {boolean} whether or not the item matches the test.
 */

/**
 * Scans through a series of filters to find an item that matches
 * any of the filters. The first item of the first filter that matches
 * will be returned.
 * @param {any[]} arr - the array to scan
 * @param {...scanArrayCallback} tests - the filtering tests.
 * @returns {any}
 */
function arrayScan(arr, ...tests) {
    if (!arr || arr.length === undefined) {
        throw new Error("Must provide an array as the first parameter.");
    }

    for (let test of tests) {
        for (let item of arr) {
            if (test(item)) {
                return item;
            }
        }
    }

    return null;
}

/**
 * An Event class for tracking changes to audio activity.
 **/
class AudioActivityEvent extends Event {
    /** Creates a new "audioActivity" event */
    constructor() {
        super("audioActivity");
        /** @type {string} */
        this.id = null;
        this.isActive = false;

        Object.seal(this);
    }

    /**
     * Sets the current state of the event
     * @param {string} id - the user for which the activity changed
     * @param {boolean} isActive - the new state of the activity
     */
    set(id, isActive) {
        this.id = id;
        this.isActive = isActive;
    }
}

function t(o, s, c) {
    return typeof o === s
        || o instanceof c;
}

function isFunction(obj) {
    return t(obj, "function", Function);
}

function isString(obj) {
    return t(obj, "string", String);
}

function isNumber(obj) {
    return t(obj, "number", Number);
}

/**
 * Check a value to see if it is of a number type
 * and is not the special NaN value.
 *
 * @param {any} v
 */
function isGoodNumber(v) {
    return isNumber(v)
        && !Number.isNaN(v);
}

function isBoolean(obj) {
    return t(obj, "boolean", Boolean);
}

const EventBase = (function () {
    try {
        new window.EventTarget();
        return class EventBase extends EventTarget {
            constructor() {
                super();
            }
        };
    } catch (exp) {

        /** @type {WeakMap<EventBase, Map<string, Listener[]>> */
        const selfs = new WeakMap();

        return class EventBase {

            constructor() {
                selfs.set(this, new Map());
            }

            /**
             * @param {string} type
             * @param {Function} callback
             * @param {any} options
             */
            addEventListener(type, callback, options) {
                if (isFunction(callback)) {
                    const self = selfs.get(this);
                    if (!self.has(type)) {
                        self.set(type, []);
                    }

                    const listeners = self.get(type);
                    if (!listeners.find(l => l.callback === callback)) {
                        listeners.push({
                            target: this,
                            callback,
                            options
                        });
                    }
                }
            }

            /**
             * @param {string} type
             * @param {Function} callback
             */
            removeEventListener(type, callback) {
                if (isFunction(callback)) {
                    const self = selfs.get(this);
                    if (self.has(type)) {
                        const listeners = self.get(type),
                            idx = listeners.findIndex(l => l.callback === callback);
                        if (idx >= 0) {
                            arrayRemoveAt(listeners, idx);
                        }
                    }
                }
            }

            /**
             * @param {Event} evt
             */
            dispatchEvent(evt) {
                const self = selfs.get(this);
                if (!self.has(evt.type)) {
                    return true;
                }
                else {
                    const listeners = self.get(evt.type);
                    for (let listener of listeners) {
                        if (listener.options && listener.options.once) {
                            this.removeEventListener(evt.type, listener.callback);
                        }
                        listener.callback.call(listener.target, evt);
                    }
                    return !evt.defaultPrevented;
                }
            }
        };
    }

})();

const gestures = [
    "change",
    "click",
    "contextmenu",
    "dblclick",
    "mouseup",
    "pointerup",
    "reset",
    "submit",
    "touchend"
];

/**
 * @callback onUserGestureTestCallback
 * @returns {boolean}
 */

/**
 * This is not an event handler that you can add to an element. It's a global event that
 * waits for the user to perform some sort of interaction with the website.
 * @param {Function} callback
 * @param {onUserGestureTestCallback} test
  */
function onUserGesture(callback, test) {
    test = test || (() => true);
    const check = async (evt) => {
        let testResult = test();
        if (testResult instanceof Promise) {
            testResult = await testResult;
        }

        if (evt.isTrusted && testResult) {
            for (let gesture of gestures) {
                window.removeEventListener(gesture, check);
            }

            const result = callback();
            if (result instanceof Promise) {
                await result;
            }
        }
    };

    for (let gesture of gestures) {
        window.addEventListener(gesture, check);
    }
}

/**
 * @param {string} path
 * @returns {Promise<Response>}
 */
async function getResponse(path) {
    const request = fetch(path);
    const response = await request;
    if (!response.ok) {
        throw new Error(`[${response.status}] - ${response.statusText}`);
    }
    return response;
}

/**
 * @callback progressCallback
 * @param {number} soFar
 * @param {number} total
 * @param {string?} message
 **/

/**
 * @typedef {object} getPartsReturnType
 * @property {Uint8Array} buffer
 * @property {string} contentType
 **/

/**
 * @param {string} path
 * @param {progressCallback} onProgress
 * @returns {Promise<getPartsReturnType>}
 */
async function getBufferWithProgress(path, onProgress) {
    if (!isFunction(onProgress)) {
        throw new Error("progress callback is required");
    }

    onProgress(0, 1, path);
    const response = await getResponse(path);

    const contentLength = parseInt(response.headers.get("Content-Length"), 10);
    if (!contentLength) {
        throw new Error("Server did not provide a content length header.");
    }

    const contentType = response.headers.get("Content-Type");
    if (!contentType) {
        throw new Error("Server did not provide a content type");
    }

    const reader = response.body.getReader();
    const buffer = new Uint8Array(contentLength);
    let receivedLength = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }

        if (receivedLength + value.length > contentLength) {
            throw new Error("Whoa! Recieved content exceeded expected amount");
        }

        buffer.set(value, receivedLength);
        receivedLength += value.length;
        onProgress(receivedLength, contentLength, path);
    }

    onProgress(1, 1, path);

    return { buffer, contentType };
}


/**
 * @param {string} path
 * @param {progressCallback} onProgress
 * @returns {Promise<Blob>}
 */
async function getBlobWithProgress(path, onProgress) {
    const { buffer, contentType } = await getBufferWithProgress(path, onProgress);
    const blob = new Blob([buffer], { type: contentType });
    return blob;
}

/** @type {Map<string, string>} */
const cache = new Map();

/**
 * @param {string} path
 * @param {progressCallback} onProgress
 * @returns {Promise<string>}
 */
async function getFileWithProgress(path, onProgress) {
    const key = path;
    if (cache.has(key)) {
        onProgress(0, 1, path);
        const blobUrl = cache.get(key);
        onProgress(1, 1, path);
        return blobUrl;
    }
    else {
        const blob = await getBlobWithProgress(path, onProgress);
        const blobUrl = URL.createObjectURL(blob);
        cache.set(key, blobUrl);
        return blobUrl;
    }
}

/**
 * @param {string} path
 * @param {progressCallback?} onProgress
 * @returns {Promise<Blob>}
 */
async function getBlob(path, onProgress = null) {
    if (isFunction(onProgress)) {
        return await getBlobWithProgress(path, onProgress);
    }

    const response = await getResponse(path);
    const blob = await response.blob();
    return blob;
}

/**
 * @param {string} path
 * @param {progressCallback?} onProgress
 * @returns {Promise<string>}
 */
async function getFile(path, onProgress = null) {
    if (isFunction(onProgress)) {
        return await getFileWithProgress(path, onProgress);
    }

    const blob = await getBlob(path);
    const blobUrl = URL.createObjectURL(blob);
    return blobUrl;
}

/**
 * Force a value onto a range
 *
 * @param {number} v
 * @param {number} min
 * @param {number} max
 */

function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
}

const audioActivityEvt = new AudioActivityEvent(),
    activityCounterMin = 0,
    activityCounterMax = 60,
    activityCounterThresh = 5;

/**
 * 
 * @param {number} frequency
 * @param {number} sampleRate
 * @param {number} bufferSize
 */
function frequencyToIndex(frequency, sampleRate, bufferSize) {
    const nyquist = sampleRate / 2;
    const index = Math.round(frequency / nyquist * bufferSize);
    return clamp(index, 0, bufferSize);
}

/**
 * 
 * @param {AnalyserNode} analyser
 * @param {Float32Array} frequencies
 * @param {number} minHz
 * @param {number} maxHz
 * @param {number} bufferSize
 */
function analyserFrequencyAverage(analyser, frequencies, minHz, maxHz, bufferSize) {
    const sampleRate = analyser.context.sampleRate,
        start = frequencyToIndex(minHz, sampleRate, bufferSize),
        end = frequencyToIndex(maxHz, sampleRate, bufferSize),
        count = end - start;
    let sum = 0;
    for (let i = start; i < end; ++i) {
        sum += frequencies[i];
    }
    return count === 0 ? 0 : (sum / count);
}

class ActivityAnalyser extends EventBase {
    /**
     * @param {import("./AudioSource").AudioSource} source
     * @param {AudioContext} audioContext
     * @param {number} bufferSize
     */
    constructor(source, audioContext, bufferSize) {
        super();

        if (!isGoodNumber(bufferSize)
            || bufferSize <= 0) {
            throw new Error("Buffer size must be greater than 0");
        }

        this.id = source.id;

        this.bufferSize = bufferSize;
        this.buffer = new Float32Array(this.bufferSize);

        /** @type {boolean} */
        this.wasActive = false;
        this.lastAudible = true;
        this.activityCounter = 0;

        /** @type {AnalyserNode} */
        this.analyser = null;

        const checkSource = () => {
            if (source.spatializer.source) {
                this.analyser = audioContext.createAnalyser();
                this.analyser.fftSize = 2 * this.bufferSize;
                this.analyser.smoothingTimeConstant = 0.2;
                source.spatializer.source.connect(this.analyser);
            }
            else {
                setTimeout(checkSource, 0);
            }
        };

        checkSource();
    }

    dispose() {
        if (this.analyser) {
            this.analyser.disconnect();
            this.analyser = null;
        }
        this.buffer = null;
    }

    update() {
        if (this.analyser) {
            this.analyser.getFloatFrequencyData(this.buffer);

            const average = 1.1 + analyserFrequencyAverage(this.analyser, this.buffer, 85, 255, this.bufferSize) / 100;
            if (average >= 0.5 && this.activityCounter < activityCounterMax) {
                this.activityCounter++;
            } else if (average < 0.5 && this.activityCounter > activityCounterMin) {
                this.activityCounter--;
            }

            const isActive = this.activityCounter > activityCounterThresh;
            if (this.wasActive !== isActive) {
                this.wasActive = isActive;
                audioActivityEvt.id = this.id;
                audioActivityEvt.isActive = isActive;
                this.dispatchEvent(audioActivityEvt);
            }
        }
    }
}

/**
 * Translate a value into a range.
 *
 * @param {number} v
 * @param {number} min
 * @param {number} max
 */

function project(v, min, max) {
    const delta = max - min;
    if (delta === 0) {
        return 0;
    }
    else {
        return (v - min) / delta;
    }
}

/**
 * @param {import("./Vector3").Vector3} m
 * @param {import("./Vector3").Vector3} a
 * @param {import("./Vector3").Vector3} b
 * @param {number} p
 */

function slerpVectors(m, a, b, p) {
    const dot = a.dot(b);
    const angle = Math.acos(dot);
    if (angle !== 0) {
        const c = Math.sin(angle);
        const pA = Math.sin((1 - p) * angle) / c;
        const pB = Math.sin(p * angle) / c;
        m.x = pA * a.x + pB * b.x;
        m.y = pA * a.y + pB * b.y;
        m.x = pA * a.z + pB * b.z;
    }
}

/**
 * Pick a value that is proportionally between two values.
 *
 * @param {number} a
 * @param {number} b
 * @param {number} p
 * @returns {number}
 */

function lerp(a, b, p) {
    return (1 - p) * a + p * b;
}

class Vector3 {
    constructor() {
        /** @type {number} */
        this.x = 0;

        /** @type {number} */
        this.y = 0;

        /** @type {number} */
        this.z = 0;

        Object.seal(this);
    }

    /**
     * @param {number} s
     * @returns {Vector3}
     */
    scale(s) {
        this.x *= s;
        this.y *= s;
        this.z *= s;
        return this;
    }

    /**
     * @param {Vector3} v
     * @returns {Vector3}
     */
    add(v) {
        this.x += v.x;
        this.y += v.y;
        this.z += v.z;
        return this;
    }

    /**
     * @param {Vector3} v
     * @returns {Vector3}
     */
    sub(v) {
        this.x -= v.x;
        this.y -= v.y;
        this.z -= v.z;
        return this;
    }

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {Vector3}
     */
    set(x, y, z) {
        this.x = x;
        this.y = y;
        this.z = z;
        return this;
    }

    /**
     * @param {Vector3} v
     * @returns {Vector3}
     */
    copy(v) {
        this.x = v.x;
        this.y = v.y;
        this.z = v.z;
        return this;
    }

    /**
     * @param {Vector3} v
     * @param {number} p
     * @returns {Vector3}
     */
    lerp(v, p) {
        this.x = lerp(this.x, v.x, p);
        this.y = lerp(this.y, v.y, p);
        this.z = lerp(this.z, v.z, p);
        return this;
    }

    /**
     * @param {Vector3} v
     */
    dot(v) {
        return this.x * v.x + this.y * v.y + this.z * v.z;
    }

    /**
     * @returns {Vector3}
     */
    normalize() {
        const lenSqr = this.dot(this);
        if (lenSqr > 0) {
            const len = Math.sqrt(lenSqr);
            this.x /= len;
            this.y /= len;
            this.z /= len;
        }
        return this;
    }
}

/**
 * A position and orientation, at a given time.
 **/
class Pose {
    /**
     * Creates a new position and orientation, at a given time.
     **/
    constructor() {
        this.t = 0;
        this.p = new Vector3();
        this.f = new Vector3();
        this.f.set(0, 0, -1);
        this.u = new Vector3();
        this.u.set(0, 1, 0);

        Object.seal(this);
    }


    /**
     * Sets the components of the pose.
     * @param {number} px
     * @param {number} py
     * @param {number} pz
     * @param {number} fx
     * @param {number} fy
     * @param {number} fz
     * @param {number} ux
     * @param {number} uy
     * @param {number} uz
     */
    set(px, py, pz, fx, fy, fz, ux, uy, uz) {
        this.p.set(px, py, pz);
        this.f.set(fx, fy, fz);
        this.u.set(ux, uy, uz);
    }

    /**
     * Copies the components of another pose into this pose.
     * @param {Pose} other
     */
    copy(other) {
        this.p.copy(other.p);
        this.f.copy(other.f);
        this.u.copy(other.u);
    }

    /**
     * Performs a lerp between two positions and a slerp between to orientations
     * and stores the result in this pose.
     * @param {Pose} a
     * @param {Pose} b
     * @param {number} p
     */
    interpolate(start, end, t) {
        if (t <= start.t) {
            this.copy(start);
        }
        else if (end.t <= t) {
            this.copy(end);
        }
        else if (start.t < t) {
            const p = project(t, start.t, end.t);
            this.p.copy(start.p);
            this.p.lerp(end.p, p);
            slerpVectors(this.f, start.f, end.f, p);
            slerpVectors(this.u, start.u, end.u, p);
            this.t = t;
        }
    }
}

/**
 * A position value that is blended from the current position to
 * a target position over time.
 */
class InterpolatedPose {

    /**
     * Creates a new position value that is blended from the current position to
     * a target position over time.
     **/
    constructor() {
        this.start = new Pose();
        this.current = new Pose();
        this.end = new Pose();

        Object.seal(this);
    }

    /**
     * Set the target position and orientation for the time `t + dt`.
     * @param {number} px - the horizontal component of the position.
     * @param {number} py - the vertical component of the position.
     * @param {number} pz - the lateral component of the position.
     * @param {number} fx - the horizontal component of the position.
     * @param {number} fy - the vertical component of the position.
     * @param {number} fz - the lateral component of the position.
     * @param {number} ux - the horizontal component of the position.
     * @param {number} uy - the vertical component of the position.
     * @param {number} uz - the lateral component of the position.
     * @param {number} t - the time at which to start the transition.
     * @param {number} dt - the amount of time to take making the transition.
     */
    setTarget(px, py, pz, fx, fy, fz, ux, uy, uz, t, dt) {
        this.end.set(px, py, pz, fx, fy, fz, ux, uy, uz);
        this.end.t = t + dt;
        if (dt <= 0) {
            this.start.copy(this.end);
            this.start.t = t;
            this.current.copy(this.end);
            this.current.t = t;
        }
        else {
            this.start.copy(this.current);
            this.start.t = t;
        }
    }

    /**
     * Set the target position for the time `t + dt`.
     * @param {number} px - the horizontal component of the position.
     * @param {number} py - the vertical component of the position.
     * @param {number} pz - the lateral component of the position.
     * @param {number} t - the time at which to start the transition.
     * @param {number} dt - the amount of time to take making the transition.
     */
    setTargetPosition(px, py, pz, t, dt) {
        this.setTarget(
            px, py, pz,
            this.end.f.x, this.end.f.y, this.end.f.z,
            this.end.u.x, this.end.u.y, this.end.u.z,
            t, dt);
    }

    /**
     * Set the target orientation for the time `t + dt`.
     * @param {number} fx - the horizontal component of the position.
     * @param {number} fy - the vertical component of the position.
     * @param {number} fz - the lateral component of the position.
     * @param {number} ux - the horizontal component of the position.
     * @param {number} uy - the vertical component of the position.
     * @param {number} uz - the lateral component of the position.
     * @param {number} t - the time at which to start the transition.
     * @param {number} dt - the amount of time to take making the transition.
     */
    setTargetOrientation(fx, fy, fz, ux, uy, uz, t, dt) {
        this.setTarget(
            this.end.p.x, this.end.p.y, this.end.p.z,
            fx, fy, fz,
            ux, uy, uz,
            t, dt);
    }

    /**
     * Calculates the new position for the given time.
     * @protected
     * @param {number} t
     */
    update(t) {
        this.current.interpolate(this.start, this.end, t);
    }
}

/**
 * @typedef {object} JitsiTrack
 * @property {Function} getParticipantId
 * @property {Function} getType
 * @property {Function} isMuted
 * @property {Function} isLocal
 * @property {Function} addEventListener
 * @property {Function} dispose
 * @property {MediaStream} stream
 **/

class AudioSource {
    constructor() {
        this.pose = new InterpolatedPose();

        /** @type {Map<string, JitsiTrack>} */
        this.tracks = new Map();

        /** @type {import("./spatializers/sources/BaseSource").BaseSource} */
        this._spatializer = null;
    }

    get spatializer() {
        return this._spatializer;
    }

    set spatializer(v) {
        if (this.spatializer !== v) {
            if (this._spatializer) {
                this._spatializer.dispose();
            }
            this._spatializer = v;
        }
    }

    dispose() {
        this.spatializer = null;
    }

    /**
     * Update the user.
     * @param {number} t - the current update time.
     */
    update(t) {
        this.pose.update(t);
        if (this.spatializer) {
            this.spatializer.update(this.pose.current);
        }
    }
}

/**
 * A mocking class for providing the playback timing needed to synchronize motion and audio.
 **/
class MockAudioContext {
    /**
     * Starts the timer at "now".
     **/
    constructor() {
        this._t = performance.now() / 1000;

        Object.seal(this);
    }

    /**
     * Gets the current playback time.
     * @type {number}
     */
    get currentTime() {
        return performance.now() / 1000 - this._t;
    }

    /**
     * Returns nothing.
     * @type {AudioDestinationNode} */
    get destination() {
        return null;
    }
}

/**
 * Indicates whether or not the current browser can change the destination device for audio output.
 * @constant
 * @type {boolean}
 **/
const canChangeAudioOutput = HTMLAudioElement.prototype["setSinkId"] instanceof Function;

/** Base class providing functionality for spatializers. */
class BaseSpatializer extends EventBase {

    /**
     * Creates a spatializer that keeps track of position
     */
    constructor() {
        super();

        this.minDistance = 1;
        this.minDistanceSq = 1;
        this.maxDistance = 10;
        this.maxDistanceSq = 100;
        this.rolloff = 1;
        this.transitionTime = 0.5;
    }

    /**
     * Sets parameters that alter spatialization.
     * @param {number} minDistance
     * @param {number} maxDistance
     * @param {number} rolloff
     * @param {number} transitionTime
     **/
    setAudioProperties(minDistance, maxDistance, rolloff, transitionTime) {
        this.minDistance = minDistance;
        this.maxDistance = maxDistance;
        this.transitionTime = transitionTime;
        this.rolloff = rolloff;
    }

    /**
     * Discard values and make this instance useless.
     */
    dispose() {
    }

    /**
     * Performs the spatialization operation for the audio source's latest location.
     * @param {import("../positions/Pose").Pose} loc
     */
    update(loc) {
    }
}

/** Base class providing functionality for spatializers. */
class BaseSource extends BaseSpatializer {
    /**
     * Creates a spatializer that keeps track of the relative position
     * of an audio element to the listener destination.
     * @param {string} id
     * @param {MediaStream|HTMLAudioElement} stream
     * @param {AudioContext} audioContext - the output WebAudio context
     * @param {AudioNode} destination - this node out to which to pipe the stream
     */
    constructor(id, stream, audioContext, destination) {
        super();

        this.id = id;

        /** @type {HTMLAudioElement} */
        this.audio = null;

        /** @type {MediaStream} */
        this.stream = null;

        /** @type {AudioNode} */
        this.source = null;

        this.volume = 1;

        if (stream instanceof HTMLAudioElement) {
            this.audio = stream;
            this.source = audioContext.createMediaElementSource(this.audio);
            this.source.connect(destination);
        }
        else if (stream instanceof MediaStream) {
            this.stream = stream;
            this.audio = document.createElement("audio");
            this.audio.srcObject = this.stream;

            const checkSource = () => {
                if (this.stream.active) {
                    this.source = audioContext.createMediaStreamSource(this.stream);
                    this.source.connect(destination);
                }
                else {
                    setTimeout(checkSource, 0);
                }
            };

            setTimeout(checkSource, 0);
        }
        else if (stream !== null) {
            throw new Error("Can't create a node from the given stream. Expected type HTMLAudioElement or MediaStream.");
        }

        this.audio.playsInline = true;
    }

    async play() {
        if (this.audio) {
            await this.audio.play();
        }
    }

    stop() {
        if (this.audio) {
            this.audio.pause();
        }
    }

    /**
     * Discard values and make this instance useless.
     */
    dispose() {
        if (this.source) {
            this.source.disconnect();
            this.source = null;
        }

        if (this.audio) {
            this.audio.pause();
            this.audio = null;
        }

        this.stream = null;

        super.dispose();
    }

    /**
     * Changes the device to which audio will be output
     * @param {string} deviceID
     */
    setAudioOutputDevice(deviceID) {
        if (this.audio && canChangeAudioOutput) {
            this.audio.setSinkId(deviceID);
        }
    }
}

class BaseRoutedSource extends BaseSource {

    /**
     * @param {string} id
     * @param {MediaStream|HTMLAudioElement} stream
     * @param {AudioContext} audioContext
     * @param {AudioNode} inNode
     */
    constructor(id, stream, audioContext, inNode) {
        super(id, stream, audioContext, inNode);

        /** @type {AudioNode} */
        this.inNode = inNode;
        this.inNode.connect(audioContext.destination);
    }

    /**
     * Discard values and make this instance useless.
     */
    dispose() {
        if (this.inNode) {
            this.inNode.disconnect();
            this.inNode = null;
        }

        super.dispose();
    }
}

/**
 * A spatializer that uses WebAudio's PannerNode
 **/
class PannerBase extends BaseRoutedSource {

    /**
     * Creates a new spatializer that uses WebAudio's PannerNode.
     * @param {string} id
     * @param {MediaStream|HTMLAudioElement} stream
     * @param {AudioContext} audioContext
     */
    constructor(id, stream, audioContext) {
        const panner = audioContext.createPanner();
        super(id, stream, audioContext, panner);

        this.inNode.panningModel = "HRTF";
        this.inNode.distanceModel = "inverse";
        this.inNode.coneInnerAngle = 360;
        this.inNode.coneOuterAngle = 0;
        this.inNode.coneOuterGain = 0;
    }

    /**
     * Performs the spatialization operation for the audio source's latest location.
     * @param {import("../../positions/Pose").Pose} loc
     */
    update(loc) {
        super.update(loc);
        this.inNode.refDistance = this.minDistance;
        this.inNode.rolloffFactor = this.rolloff;
    }
}

/**
 * A positioner that uses WebAudio's playback dependent time progression.
 **/
class PannerNew extends PannerBase {

    /**
     * Creates a new positioner that uses WebAudio's playback dependent time progression.
     * @param {string} id
     * @param {MediaStream|HTMLAudioElement} stream
     * @param {AudioContext} audioContext
     */
    constructor(id, stream, audioContext) {
        super(id, stream, audioContext);

        Object.seal(this);
    }

    /**
     * Performs the spatialization operation for the audio source's latest location.
     * @param {import("../../positions/Pose").Pose} loc
     */
    update(loc) {
        super.update(loc);
        const { p, f } = loc;
        this.inNode.positionX.setValueAtTime(p.x, 0);
        this.inNode.positionY.setValueAtTime(p.y, 0);
        this.inNode.positionZ.setValueAtTime(p.z, 0);
        this.inNode.orientationX.setValueAtTime(f.x, 0);
        this.inNode.orientationY.setValueAtTime(f.y, 0);
        this.inNode.orientationZ.setValueAtTime(f.z, 0);
    }
}

class DirectSource extends BaseSource {
    /**
     * Creates a new "spatializer" that performs no panning. An anti-spatializer.
     * @param {string} id
     * @param {MediaStream|HTMLAudioElement} stream
     * @param {AudioContext} audioContext
     */
    constructor(id, stream, audioContext) {
        super(id, stream, audioContext, audioContext.destination);
    }
}

class BaseListener extends BaseSpatializer {
    /**
     * Creates a spatializer that keeps track of position
     */
    constructor() {
        super();
    }

    /**
     * Creates a spatialzer for an audio source.
     * @private
     * @param {string} id
     * @param {MediaStream|HTMLAudioElement} stream - the audio element that is being spatialized.
     * @param {boolean} spatialize - whether or not the audio stream should be spatialized. Stereo audio streams that are spatialized will get down-mixed to a single channel.
     * @param {AudioContext} audioContext
     * @return {BaseSource}
     */
    createSource(id, stream, spatialize, audioContext) {
        if (spatialize) {
            throw new Error("Calla no longer supports manual volume scaling");
        }
        else {
            return new DirectSource(id, stream, audioContext);
        }
    }
}

/**
 * A spatializer that uses WebAudio's AudioListener
 **/
class AudioListenerBase extends BaseListener {

    /**
     * Creates a new spatializer that uses WebAudio's PannerNode.
     * @param {AudioListener} listener
     */
    constructor(listener) {
        super();
        this.node = listener;
    }

    dispose() {
        this.node = null;
        super.dispose();
    }
}

/**
 * A positioner that uses WebAudio's playback dependent time progression.
 **/
class AudioListenerNew extends AudioListenerBase {
    /**
     * Creates a new positioner that uses WebAudio's playback dependent time progression.
     * @param {AudioListener} listener
     */
    constructor(listener) {
        super(listener);

        Object.seal(this);
    }

    /**
     * Performs the spatialization operation for the audio source's latest location.
     * @param {import("../../positions/Pose").Pose} loc
     */
    update(loc) {
        super.update(loc);
        const { p, f, u } = loc;
        this.node.positionX.setValueAtTime(p.x, 0);
        this.node.positionY.setValueAtTime(p.y, 0);
        this.node.positionZ.setValueAtTime(p.z, 0);
        this.node.forwardX.setValueAtTime(f.x, 0);
        this.node.forwardY.setValueAtTime(f.y, 0);
        this.node.forwardZ.setValueAtTime(f.z, 0);
        this.node.upX.setValueAtTime(u.x, 0);
        this.node.upY.setValueAtTime(u.y, 0);
        this.node.upZ.setValueAtTime(u.z, 0);
    }


    /**
     * Creates a spatialzer for an audio source.
     * @private
     * @param {string} id
     * @param {MediaStream|HTMLAudioElement} stream - the audio element that is being spatialized.
     * @param {boolean} spatialize - whether or not the audio stream should be spatialized. Stereo audio streams that are spatialized will get down-mixed to a single channel.
     * @param {AudioContext} audioContext
     * @return {BaseSource}
     */
    createSource(id, stream, spatialize, audioContext) {
        if (spatialize) {
            return new PannerNew(id, stream, audioContext);
        }
        else {
            return super.createSource(id, stream, spatialize, audioContext);
        }
    }
}

/**
 * A positioner that uses the WebAudio API's old setPosition method.
 **/
class PannerOld extends PannerBase {

    /**
     * Creates a new positioner that uses the WebAudio API's old setPosition method.
     * @param {string} id
     * @param {MediaStream|HTMLAudioElement} stream
     * @param {AudioContext} audioContext
     */
    constructor(id, stream, audioContext) {
        super(id, stream, audioContext);

        Object.seal(this);
    }

    /**
     * Performs the spatialization operation for the audio source's latest location.
     * @param {import("../../positions/Pose").Pose} loc
     */
    update(loc) {
        super.update(loc);
        const { p, f } = loc;
        this.inNode.setPosition(p.x, p.y, p.z);
        this.inNode.setOrientation(f.x, f.y, f.z);
    }
}

/**
 * A positioner that uses WebAudio's playback dependent time progression.
 **/
class AudioListenerOld extends AudioListenerBase {
    /**
     * Creates a new positioner that uses WebAudio's playback dependent time progression.
     * @param {AudioListener} listener
     */
    constructor(listener) {
        super(listener);

        Object.seal(this);
    }

    /**
     * Performs the spatialization operation for the audio source's latest location.
     * @param {import("../../positions/Pose").Pose} loc
     */
    update(loc) {
        super.update(loc);
        const { p, f, u } = loc;
        this.node.setPosition(p.x, p.y, p.z);
        this.node.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }

    /**
     * Creates a spatialzer for an audio source.
     * @private
     * @param {string} id
     * @param {MediaStream|HTMLAudioElement} stream - the audio element that is being spatialized.
     * @param {boolean} spatialize - whether or not the audio stream should be spatialized. Stereo audio streams that are spatialized will get down-mixed to a single channel.
     * @param {AudioContext} audioContext
     * @return {import("../sources/BaseSource").BaseSource}
     */
    createSource(id, stream, spatialize, audioContext) {
        if (spatialize) {
            return new PannerOld(id, stream, audioContext);
        }
        else {
            return super.createSource(id, stream, spatialize, audioContext);
        }
    }
}

/**
 * @license
 * Copyright 2016 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @file Omnitone library common utilities.
 */


/**
 * Utility namespace.
 * @namespace
 */



/**
 * Omnitone library logging function.
 * @param {any} Message to be printed out.
 */
function log() {
    const message = `[Omnitone] \
${Array.prototype.slice.call(arguments).join(' ')} \
(${performance.now().toFixed(2)}ms)`;
    window.console.log(message);
}


/**
 * Omnitone library error-throwing function.
 * @param {any} Message to be printed out.
 */
function throwError () {
    const message = `[Omnitone] \
${Array.prototype.slice.call(arguments).join(' ')} \
(${performance.now().toFixed(2)}ms)`;
    window.console.error(message);
    throw new Error(message);
}


/**
 * Check if a value is defined in the ENUM dictionary.
 * @param {Object} enumDictionary - ENUM dictionary.
 * @param {Number|String} entryValue - a value to probe.
 * @return {Boolean}
 */
function isDefinedENUMEntry(enumDictionary, entryValue) {
    for (let enumKey in enumDictionary) {
        if (entryValue === enumDictionary[enumKey]) {
            return true;
        }
    }
    return false;
}


/**
 * Check if the given object is an instance of BaseAudioContext.
 * @param {AudioContext} context - A context object to be checked.
 * @return {Boolean}
 */
function isAudioContext(context) {
    // TODO(hoch): Update this when BaseAudioContext is available for all
    // browsers.
    return context instanceof AudioContext ||
        context instanceof OfflineAudioContext;
}


/**
 * Converts Base64-encoded string to ArrayBuffer.
 * @param {string} base64String - Base64-encdoed string.
 * @return {ArrayBuffer} Converted ArrayBuffer object.
 */
function getArrayBufferFromBase64String(base64String) {
    const binaryString = window.atob(base64String);
    const byteArray = new Uint8Array(binaryString.length);
    byteArray.forEach(
        (value, index) => byteArray[index] = binaryString.charCodeAt(index));
    return byteArray.buffer;
}

/**
 * @license
 * Copyright 2017 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Buffer data type for ENUM.
 * @readonly
 * @enum {string}
 */
const BufferDataType = {
    /** The data contains Base64-encoded string.. */
    BASE64: 'base64',
    /** The data is a URL for audio file. */
    URL: 'url',
};

/**
 * BufferList options
 * @typedef {object} BufferListOptions
 * @property {string?} [dataType=base64] - BufferDataType specifier
 * @property {boolean?} [verbose=false] - Log verbosity. |true| prints the individual message from each URL and AudioBuffer.
 **/

/**
 * BufferList object mananges the async loading/decoding of multiple
 * AudioBuffers from multiple URLs.
 */
class BufferList {
    /**
     * BufferList object mananges the async loading/decoding of multiple
     * AudioBuffers from multiple URLs.
     * @param {BaseAudioContext} context - Associated BaseAudioContext.
     * @param {string[]} bufferData - An ordered list of URLs.
     * @param {BufferListOptions} options - Options.
     */
    constructor(context, bufferData, options) {
        if (!isAudioContext(context)) {
            throwError('BufferList: Invalid BaseAudioContext.');
        }

        this._context = context;

        this._options = {
            dataType: BufferDataType.BASE64,
            verbose: false,
        };

        if (options) {
            if (options.dataType &&
                isDefinedENUMEntry(BufferDataType, options.dataType)) {
                this._options.dataType = options.dataType;
            }
            if (options.verbose) {
                this._options.verbose = Boolean(options.verbose);
            }
        }

        this._bufferData = this._options.dataType === BufferDataType.BASE64
            ? bufferData
            : bufferData.slice(0);
    }


    /**
     * Starts AudioBuffer loading tasks.
     * @return {Promise<AudioBuffer[]>} The promise resolves with an array of
     * AudioBuffer.
     */
    async load() {
        try {
            const tasks = this._bufferData.map(async (bData, taskId) => {
                try {
                    return await this._launchAsyncLoadTask(bData, taskId);
                }
                catch (exp) {
                    const message = 'BufferList: error while loading "' +
                        bData + '". (' + exp.message + ')';
                    throwError(message);
                }
            });

            const buffers = await Promise.all(tasks);

            const messageString = this._options.dataType === BufferDataType.BASE64
                ? this._bufferData.length + ' AudioBuffers from Base64-encoded HRIRs'
                : this._bufferData.length + ' files via XHR';
            log('BufferList: ' + messageString + ' loaded successfully.');

            return buffers;
        }
        catch (exp) {
            const message = 'BufferList: error while loading ". (' + exp.message + ')';
            throwError(message);
        }
    }

    /**
     * Run async loading task for Base64-encoded string.
     * @private
     * @param {string} bData - Base64-encoded data.
     * @param {Number} taskId Task ID number from the ordered list |bufferData|.
     * @returns {Promise<AudioBuffer>}
     */
    async _launchAsyncLoadTask(bData, taskId) {
        const arrayBuffer = await this._fetch(bData);
        const audioBuffer = await this._context.decodeAudioData(arrayBuffer);
        const messageString = this._options.dataType === BufferDataType.BASE64
            ? 'ArrayBuffer(' + taskId + ') from Base64-encoded HRIR'
            : '"' + bData + '"';
        log('BufferList: ' + messageString + ' successfully loaded.');
        return audioBuffer;
    }

    /**
     * Get an array buffer out of the given data.
     * @private
     * @param {string} bData - Base64-encoded data.
     * @returns {Promise<ArrayBuffer>}
     */
    async _fetch(bData) {
        if (this._options.dataType === BufferDataType.BASE64) {
            return getArrayBufferFromBase64String(bData);
        }
        else {
            const response = await fetch(bData);
            return await response.arrayBuffer();
        }
    }
}

/**
 * @license
 * Copyright 2017 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */


/**
 * @file A collection of convolvers. Can be used for the optimized FOA binaural
 * rendering. (e.g. SH-MaxRe HRTFs)
 */


/**
 * FOAConvolver. A collection of 2 stereo convolvers for 4-channel FOA stream.
 */
class FOAConvolver {
    /**
     * FOAConvolver. A collection of 2 stereo convolvers for 4-channel FOA stream.
     * @param {BaseAudioContext} context The associated AudioContext.
     * @param {AudioBuffer[]} [hrirBufferList] - An ordered-list of stereo
     * AudioBuffers for convolution. (i.e. 2 stereo AudioBuffers for FOA)
     */
    constructor(context, hrirBufferList) {
        this._context = context;

        this._active = false;
        this._isBufferLoaded = false;

        this._buildAudioGraph();

        if (hrirBufferList) {
            this.setHRIRBufferList(hrirBufferList);
        }

        this.enable();
    }


    /**
     * Build the internal audio graph.
     *
     * @private
     */
    _buildAudioGraph() {
        this._splitterWYZX = this._context.createChannelSplitter(4);
        this._mergerWY = this._context.createChannelMerger(2);
        this._mergerZX = this._context.createChannelMerger(2);
        this._convolverWY = this._context.createConvolver();
        this._convolverZX = this._context.createConvolver();
        this._splitterWY = this._context.createChannelSplitter(2);
        this._splitterZX = this._context.createChannelSplitter(2);
        this._inverter = this._context.createGain();
        this._mergerBinaural = this._context.createChannelMerger(2);
        this._summingBus = this._context.createGain();

        // Group W and Y, then Z and X.
        this._splitterWYZX.connect(this._mergerWY, 0, 0);
        this._splitterWYZX.connect(this._mergerWY, 1, 1);
        this._splitterWYZX.connect(this._mergerZX, 2, 0);
        this._splitterWYZX.connect(this._mergerZX, 3, 1);

        // Create a network of convolvers using splitter/merger.
        this._mergerWY.connect(this._convolverWY);
        this._mergerZX.connect(this._convolverZX);
        this._convolverWY.connect(this._splitterWY);
        this._convolverZX.connect(this._splitterZX);
        this._splitterWY.connect(this._mergerBinaural, 0, 0);
        this._splitterWY.connect(this._mergerBinaural, 0, 1);
        this._splitterWY.connect(this._mergerBinaural, 1, 0);
        this._splitterWY.connect(this._inverter, 1, 0);
        this._inverter.connect(this._mergerBinaural, 0, 1);
        this._splitterZX.connect(this._mergerBinaural, 0, 0);
        this._splitterZX.connect(this._mergerBinaural, 0, 1);
        this._splitterZX.connect(this._mergerBinaural, 1, 0);
        this._splitterZX.connect(this._mergerBinaural, 1, 1);

        // By default, WebAudio's convolver does the normalization based on IR's
        // energy. For the precise convolution, it must be disabled before the buffer
        // assignment.
        this._convolverWY.normalize = false;
        this._convolverZX.normalize = false;

        // For asymmetric degree.
        this._inverter.gain.value = -1;

        // Input/output proxy.
        this.input = this._splitterWYZX;
        this.output = this._summingBus;
    }

    dispose() {
        if (this._active) {
            this.disable();
        }

        // Group W and Y, then Z and X.
        this._splitterWYZX.disconnect(this._mergerWY, 0, 0);
        this._splitterWYZX.disconnect(this._mergerWY, 1, 1);
        this._splitterWYZX.disconnect(this._mergerZX, 2, 0);
        this._splitterWYZX.disconnect(this._mergerZX, 3, 1);

        // Create a network of convolvers using splitter/merger.
        this._mergerWY.disconnect(this._convolverWY);
        this._mergerZX.disconnect(this._convolverZX);
        this._convolverWY.disconnect(this._splitterWY);
        this._convolverZX.disconnect(this._splitterZX);
        this._splitterWY.disconnect(this._mergerBinaural, 0, 0);
        this._splitterWY.disconnect(this._mergerBinaural, 0, 1);
        this._splitterWY.disconnect(this._mergerBinaural, 1, 0);
        this._splitterWY.disconnect(this._inverter, 1, 0);
        this._inverter.disconnect(this._mergerBinaural, 0, 1);
        this._splitterZX.disconnect(this._mergerBinaural, 0, 0);
        this._splitterZX.disconnect(this._mergerBinaural, 0, 1);
        this._splitterZX.disconnect(this._mergerBinaural, 1, 0);
        this._splitterZX.disconnect(this._mergerBinaural, 1, 1);
    }


    /**
     * Assigns 2 HRIR AudioBuffers to 2 convolvers: Note that we use 2 stereo
     * convolutions for 4-channel direct convolution. Using mono convolver or
     * 4-channel convolver is not viable because mono convolution wastefully
     * produces the stereo outputs, and the 4-ch convolver does cross-channel
     * convolution. (See Web Audio API spec)
     * @param {AudioBuffer[]} hrirBufferList - An array of stereo AudioBuffers for
     * convolvers.
     */
    setHRIRBufferList(hrirBufferList) {
        // After these assignments, the channel data in the buffer is immutable in
        // FireFox. (i.e. neutered) So we should avoid re-assigning buffers, otherwise
        // an exception will be thrown.
        if (this._isBufferLoaded) {
            return;
        }

        this._convolverWY.buffer = hrirBufferList[0];
        this._convolverZX.buffer = hrirBufferList[1];
        this._isBufferLoaded = true;
    }


    /**
     * Enable FOAConvolver instance. The audio graph will be activated and pulled by
     * the WebAudio engine. (i.e. consume CPU cycle)
     */
    enable() {
        this._mergerBinaural.connect(this._summingBus);
        this._active = true;
    }


    /**
     * Disable FOAConvolver instance. The inner graph will be disconnected from the
     * audio destination, thus no CPU cycle will be consumed.
     */
    disable() {
        this._mergerBinaural.disconnect();
        this._active = false;
    }
}

const OmnitoneFOAHrirBase64 = [
"UklGRiQEAABXQVZFZm10IBAAAAABAAIAgLsAAADuAgAEABAAZGF0YQAEAAD+/wIA9v8QAPv/CwD+/wcA/v8MAP//AQD7/wEACAAEAPj/+v8YABAA7v/n//v/9P/M/8D//f34/R38EvzxAfEBtA2lDTcBJQFJ9T71FP0D/cD1tfVo/Wv9uPTO9PPmOufc/U/+agL3Aisc/RxuGKEZBv3j/iYMzQ2gAzsEQQUABiQFrASzA5cB2QmyCy0AtgR4AeYGtfgAA2j5OQHP+scArPsMBJgEggIEBtz6+QVq/pj/aPg8BPP3gQEi+jEAof0fA1v9+/7S+8IBjvwd/xD4IADL/Pf9zvs+/l3+wgB7/+L+7fzFADH9kf6A+n3+DP6+/TP9xP68/pn+w/26/i39YgA0/u790Pt9/kD+7v1s/Wb+8f4C/1P+pf/x/cT+6/3p/Xz9ff5F/0f9G/4r/6v/4P5L/sL+ff7c/pj+Ov7X/UT+9P5G/oz+6v6A/2D+9/6P/8r/bP7m/ij+C//e/tj/Gf4e/9v+FwDP/lz/sP7F/2H+rv/G/s7/Hf7y/4P+NAD9/k0AK/6w/zP/hACh/sX/gf44AOP+dgCm/iUAk/5qAOD+PwC+/jEAWP4CAAr/bQBw/vv/zf5iACD/OgCS/uD/Cv9oAAb/CgDK/kwA//5tACH/TgCg/h4AHP9aABP/JADP/hEAYv9gAAj/3f8m/ysAYv8gACX/8/8k/ysAXv8bABH//v8j/ygAa/8qAAD/9f9g/1YAWf8JACH/AgB2/z4AXP/w/z3/FgB2/ykAX//9/z//EwCV/zUAS//n/1T/GACK/x4ATv/0/4P/QQB4//v/WP/2/3X/HAB8//P/V//3/2f/AQBh/9v/Tf/x/5P/IwCI/wMAf/8hAKP/JACZ/xUAiv8nAK//HgCr/yMAm/8uAMz/OACi/yQAqf87AMT/MwCY/yUAtP9FAMH/KgCu/ycAyP85AMv/IwCz/xoA1f8qAMn/FgC8/xQA4/8nAMX/CwDJ/xQA4f8ZAMH/BgDO/xQA4f8WAMP/BwDU/xQA4P8QAMH/AQDb/xQA3P8JAMP/AgDh/xIA2v8EAMj/AgDk/w0A1f/+/8v/AwDm/wwA0v/+/9H/BgDl/wkAzv/8/9T/BwDk/wcAzv/8/9r/CQDi/wQAzf/8/9//CADf////0P/9/+L/BwDd//7/0////+T/BgDb//z/1f8AAOf/BQDZ//v/2v8CAOb/AwDY//v/3v8EAOb/AgDY//3/4f8FAOX/AQDZ//7/5P8GAOP/AADb/wAA5/8GAOH////d/wIA5/8FAOD////f/wMA6P8FAOD////h/wQA6P8EAN7////h/wUA4v8DANv/AQDd/wQA3P8CANn/AgDb/wMA2/8CANv/AgDd/wIA3v8CAOH/AQDj/wEA",
"UklGRiQEAABXQVZFZm10IBAAAAABAAIAgLsAAADuAgAEABAAZGF0YQAEAAAAAAAA/f8CAP//AQD//wEA//8BAP3/AAACAP7/+f8AAAIA/P8FAAQA8/8AABoA+f/V/wQAHQDO/xoAQQBO/ocA0Px1/ucHW/4UCm8HLO6kAjv8/fCRDdAAYfPiBIgFXveUCM0GBvh6/nz7rf0J/QcQSRVdBgoBSgFR62r9NP8m+LoEAvriBVAAiAPmABEGMf2l+SwBjva6/G4A//8P/CYDMgXm/R0CKAE6/fcBBwAtAND+kQA0A5UDhwFs/8IB8fydAEP/A/8v/e7/mP8j/2YBIwE3Av0AYv+uAOD8lgAg/wwAIf/L/n0Ae//OAJMB3P/XAF//XwCM/08AB/8NAEf/rf4jAT3/lgAJAP4AHgDpAO8AUf9L/07/Qf8KAOD/x/+D/3sATQCDAMoA0f79/+L/EQDt/7EAqv+S/7IAuv/o/wgAc//X//H/SwCm/+3/Yf/B/yoAAADI/7X/AwBg/5EATgCX/xYA/P+q/00AVACY/6v/BADD/zwALQCN/8z/KQDu/ygAEgCZ/6f/VQDC//T/KQCs/7P/UgAfAO7/NgC8/57/awAZAPP/+P/V/8z/bQBBAL//DgD0/+T/TABBAMz/CwAxAPz/SQBqALn/BgALAPz/EAA7AIz/3/8iAAUA//8kALf/y/9VABQA+v81AOj/0P9cAB4A+f8WAOr/vv83ABgAw/8JAOj/4f8nACIAsf/y/w4A3v8gACQAxP/n/ycA7P8WAC0Ayf/U/ycA9v/7/yUA0P/P/zUABADc/xUA5P/J/zcACwDS/xUA9P/m/zAACQDX/+3/9v/2/yQACgDZ/+P/AwAKABYA///b/9j/EQALABkADgD6/+7/GwD4/w4A8P/w//j/EgAEAAUA9f/1/wQAGgD4/wAA5////wAAGQD1////7f8FAAUAFQDv/wAA6v8LAAcAFQDs/wEA9P8SAAYACwDr//7/AQASAAYABQDv/wIAAwAWAAIAAgDv/wAABgATAAEA/f/u/wQABgAQAPr/+P/z/wUACQALAPj/9//4/wgABwAKAPT/+f/5/w4ABwAIAPT/+//9/w4AAwADAPH//f///w8A//8BAPP///8BAA0A/f/+//X/AgACAA0A+//8//b/BAADAAoA+f/7//n/BgADAAcA+P/7//v/BwABAAQA+P/8//3/CQABAAIA9//9////CQD/////+P///wAACAD9//7/+f8AAAAABwD8//3/+v8CAAAABgD7//z//P8EAAAABAD6//3//P8FAP//AgD6//7//v8FAP7/AQD7//////8GAP7/AAD7/wEA//8EAP3/AAD9/wEA/v8DAP3/AAD9/wIA/v8CAP3/AQD9/wIA/v8CAP7/AQD+/wEA",
];

/**
 * @license
 * Copyright 2016 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @file Sound field rotator for first-order-ambisonics decoding.
 */


/**
 * First-order-ambisonic decoder based on gain node network.
 */
class FOARotator {
    /**
     * First-order-ambisonic decoder based on gain node network.
     * @param {AudioContext} context - Associated AudioContext.
     */
    constructor(context) {
        this._context = context;

        this._splitter = this._context.createChannelSplitter(4);
        this._inX = this._context.createGain();
        this._inY = this._context.createGain();
        this._inZ = this._context.createGain();
        this._m0 = this._context.createGain();
        this._m1 = this._context.createGain();
        this._m2 = this._context.createGain();
        this._m3 = this._context.createGain();
        this._m4 = this._context.createGain();
        this._m5 = this._context.createGain();
        this._m6 = this._context.createGain();
        this._m7 = this._context.createGain();
        this._m8 = this._context.createGain();
        this._outX = this._context.createGain();
        this._outY = this._context.createGain();
        this._outZ = this._context.createGain();
        this._merger = this._context.createChannelMerger(4);

        // ACN channel ordering: [1, 2, 3] => [X, Y, Z]
        // X (from channel 1)
        this._splitter.connect(this._inX, 1);
        // Y (from channel 2)
        this._splitter.connect(this._inY, 2);
        // Z (from channel 3)
        this._splitter.connect(this._inZ, 3);

        this._inX.gain.value = -1;
        this._inY.gain.value = -1;
        this._inZ.gain.value = -1;

        // Apply the rotation in the world space.
        // |X|   | m0  m3  m6 |   | X * m0 + Y * m3 + Z * m6 |   | Xr |
        // |Y| * | m1  m4  m7 | = | X * m1 + Y * m4 + Z * m7 | = | Yr |
        // |Z|   | m2  m5  m8 |   | X * m2 + Y * m5 + Z * m8 |   | Zr |
        this._inX.connect(this._m0);
        this._inX.connect(this._m1);
        this._inX.connect(this._m2);
        this._inY.connect(this._m3);
        this._inY.connect(this._m4);
        this._inY.connect(this._m5);
        this._inZ.connect(this._m6);
        this._inZ.connect(this._m7);
        this._inZ.connect(this._m8);
        this._m0.connect(this._outX);
        this._m1.connect(this._outY);
        this._m2.connect(this._outZ);
        this._m3.connect(this._outX);
        this._m4.connect(this._outY);
        this._m5.connect(this._outZ);
        this._m6.connect(this._outX);
        this._m7.connect(this._outY);
        this._m8.connect(this._outZ);

        // Transform 3: world space to audio space.
        // W -> W (to channel 0)
        this._splitter.connect(this._merger, 0, 0);
        // X (to channel 1)
        this._outX.connect(this._merger, 0, 1);
        // Y (to channel 2)
        this._outY.connect(this._merger, 0, 2);
        // Z (to channel 3)
        this._outZ.connect(this._merger, 0, 3);

        this._outX.gain.value = -1;
        this._outY.gain.value = -1;
        this._outZ.gain.value = -1;

        this.setRotationMatrix3(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]));

        // input/output proxy.
        this.input = this._splitter;
        this.output = this._merger;
    }

    dispose() {
        // ACN channel ordering: [1, 2, 3] => [X, Y, Z]
        // X (from channel 1)
        this._splitter.disconnect(this._inX, 1);
        // Y (from channel 2)
        this._splitter.disconnect(this._inY, 2);
        // Z (from channel 3)
        this._splitter.disconnect(this._inZ, 3);

        // Apply the rotation in the world space.
        // |X|   | m0  m3  m6 |   | X * m0 + Y * m3 + Z * m6 |   | Xr |
        // |Y| * | m1  m4  m7 | = | X * m1 + Y * m4 + Z * m7 | = | Yr |
        // |Z|   | m2  m5  m8 |   | X * m2 + Y * m5 + Z * m8 |   | Zr |
        this._inX.disconnect(this._m0);
        this._inX.disconnect(this._m1);
        this._inX.disconnect(this._m2);
        this._inY.disconnect(this._m3);
        this._inY.disconnect(this._m4);
        this._inY.disconnect(this._m5);
        this._inZ.disconnect(this._m6);
        this._inZ.disconnect(this._m7);
        this._inZ.disconnect(this._m8);
        this._m0.disconnect(this._outX);
        this._m1.disconnect(this._outY);
        this._m2.disconnect(this._outZ);
        this._m3.disconnect(this._outX);
        this._m4.disconnect(this._outY);
        this._m5.disconnect(this._outZ);
        this._m6.disconnect(this._outX);
        this._m7.disconnect(this._outY);
        this._m8.disconnect(this._outZ);

        // Transform 3: world space to audio space.
        // W -> W (to channel 0)
        this._splitter.disconnect(this._merger, 0, 0);
        // X (to channel 1)
        this._outX.disconnect(this._merger, 0, 1);
        // Y (to channel 2)
        this._outY.disconnect(this._merger, 0, 2);
        // Z (to channel 3)
        this._outZ.disconnect(this._merger, 0, 3);
    }


    /**
     * Updates the rotation matrix with 3x3 matrix.
     * @param {Number[]} rotationMatrix3 - A 3x3 rotation matrix. (column-major)
     */
    setRotationMatrix3(rotationMatrix3) {
        this._m0.gain.value = rotationMatrix3[0];
        this._m1.gain.value = rotationMatrix3[1];
        this._m2.gain.value = rotationMatrix3[2];
        this._m3.gain.value = rotationMatrix3[3];
        this._m4.gain.value = rotationMatrix3[4];
        this._m5.gain.value = rotationMatrix3[5];
        this._m6.gain.value = rotationMatrix3[6];
        this._m7.gain.value = rotationMatrix3[7];
        this._m8.gain.value = rotationMatrix3[8];
    }


    /**
     * Updates the rotation matrix with 4x4 matrix.
     * @param {Number[]} rotationMatrix4 - A 4x4 rotation matrix. (column-major)
     */
    setRotationMatrix4(rotationMatrix4) {
        this._m0.gain.value = rotationMatrix4[0];
        this._m1.gain.value = rotationMatrix4[1];
        this._m2.gain.value = rotationMatrix4[2];
        this._m3.gain.value = rotationMatrix4[4];
        this._m4.gain.value = rotationMatrix4[5];
        this._m5.gain.value = rotationMatrix4[6];
        this._m6.gain.value = rotationMatrix4[8];
        this._m7.gain.value = rotationMatrix4[9];
        this._m8.gain.value = rotationMatrix4[10];
    }


    /**
     * Returns the current 3x3 rotation matrix.
     * @return {Number[]} - A 3x3 rotation matrix. (column-major)
     */
    getRotationMatrix3() {
        const rotationMatrix3 = new Float32Array(9);
        rotationMatrix3[0] = this._m0.gain.value;
        rotationMatrix3[1] = this._m1.gain.value;
        rotationMatrix3[2] = this._m2.gain.value;
        rotationMatrix3[3] = this._m3.gain.value;
        rotationMatrix3[4] = this._m4.gain.value;
        rotationMatrix3[5] = this._m5.gain.value;
        rotationMatrix3[6] = this._m6.gain.value;
        rotationMatrix3[7] = this._m7.gain.value;
        rotationMatrix3[8] = this._m8.gain.value;
        return rotationMatrix3;
    }


    /**
     * Returns the current 4x4 rotation matrix.
     * @return {Number[]} - A 4x4 rotation matrix. (column-major)
     */
    getRotationMatrix4() {
        const rotationMatrix4 = new Float32Array(16);
        rotationMatrix4[0] = this._m0.gain.value;
        rotationMatrix4[1] = this._m1.gain.value;
        rotationMatrix4[2] = this._m2.gain.value;
        rotationMatrix4[4] = this._m3.gain.value;
        rotationMatrix4[5] = this._m4.gain.value;
        rotationMatrix4[6] = this._m5.gain.value;
        rotationMatrix4[8] = this._m6.gain.value;
        rotationMatrix4[9] = this._m7.gain.value;
        rotationMatrix4[10] = this._m8.gain.value;
        return rotationMatrix4;
    }
}

/**
 * @license
 * Copyright 2016 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @file An audio channel router to resolve different channel layouts between
 * browsers.
 */


/**
 * @typedef {Number[]} ChannelMap
 */

/**
 * Channel map dictionary ENUM.
 * @enum {ChannelMap}
 */
const ChannelMap = {
    /** @type {Number[]} - ACN channel map for Chrome and FireFox. (FFMPEG) */
    DEFAULT: [0, 1, 2, 3],
    /** @type {Number[]} - Safari's 4-channel map for AAC codec. */
    SAFARI: [2, 0, 1, 3],
    /** @type {Number[]} - ACN > FuMa conversion map. */
    FUMA: [0, 3, 1, 2],
};


/**
 * Channel router for FOA stream.
 */
class FOARouter {
    /**
     * Channel router for FOA stream.
     * @param {AudioContext} context - Associated AudioContext.
     * @param {Number[]} channelMap - Routing destination array.
     */
    constructor(context, channelMap) {
        this._context = context;

        this._splitter = this._context.createChannelSplitter(4);
        this._merger = this._context.createChannelMerger(4);

        // input/output proxy.
        this.input = this._splitter;
        this.output = this._merger;

        this.setChannelMap(channelMap || ChannelMap.DEFAULT);
    }


    /**
     * Sets channel map.
     * @param {Number[]} channelMap - A new channel map for FOA stream.
     */
    setChannelMap(channelMap) {
        if (!Array.isArray(channelMap)) {
            return;
        }

        this._channelMap = channelMap;
        this._splitter.disconnect();
        this._splitter.connect(this._merger, 0, this._channelMap[0]);
        this._splitter.connect(this._merger, 1, this._channelMap[1]);
        this._splitter.connect(this._merger, 2, this._channelMap[2]);
        this._splitter.connect(this._merger, 3, this._channelMap[3]);
    }

    dipose() {
        this._splitter.disconnect(this._merger, 0, this._channelMap[0]);
        this._splitter.disconnect(this._merger, 1, this._channelMap[1]);
        this._splitter.disconnect(this._merger, 2, this._channelMap[2]);
        this._splitter.disconnect(this._merger, 3, this._channelMap[3]);
    }

}

/**
 * Static channel map ENUM.
 * @static
 * @type {ChannelMap}
 */
FOARouter.ChannelMap = ChannelMap;

/**
 * Rendering mode ENUM.
 * @readonly
 * @enum {string}
 */
var RenderingMode = Object.freeze({
    /** Use ambisonic rendering. */
    AMBISONIC: 'ambisonic',
    /** Bypass. No ambisonic rendering. */
    BYPASS: 'bypass',
    /** Disable audio output. */
    OFF: 'off',
});

/**
 * @license
 * Copyright 2017 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Configuration for the FAORenderer class
 * @typedef {Object} FOARendererConfig
 * @property {number[]} channelMap - Custom channel routing map. Useful for
 * handling the inconsistency in browser's multichannel audio decoding.
 * @property {string[]} hrirPathList - A list of paths to HRIR files. It
 * overrides the internal HRIR list if given.
 * @property {RenderingMode?} [renderingMode=ambisonic] - Rendering mode.
 **/

/**
 * Omnitone FOA renderer class. Uses the optimized convolution technique.
 */
class FOARenderer {

    /**
     * Omnitone FOA renderer class. Uses the optimized convolution technique.
     * @param {AudioContext} context - Associated AudioContext.
     * @param {FOARendererConfig} config
     */
    constructor(context, config) {
        if (!isAudioContext(context)) {
            throwError('FOARenderer: Invalid BaseAudioContext.');
        }

        this._context = context;


        this._config = {
            channelMap: FOARouter.ChannelMap.DEFAULT,
            renderingMode: RenderingMode.AMBISONIC,
        };

        if (config) {
            if (config.channelMap) {
                if (Array.isArray(config.channelMap) && config.channelMap.length === 4) {
                    this._config.channelMap = config.channelMap;
                } else {
                    throwError(
                        'FOARenderer: Invalid channel map. (got ' + config.channelMap
                        + ')');
                }
            }

            if (config.hrirPathList) {
                if (Array.isArray(config.hrirPathList) &&
                    config.hrirPathList.length === 2) {
                    this._config.pathList = config.hrirPathList;
                } else {
                    throwError(
                        'FOARenderer: Invalid HRIR URLs. It must be an array with ' +
                        '2 URLs to HRIR files. (got ' + config.hrirPathList + ')');
                }
            }

            if (config.renderingMode) {
                if (Object.values(RenderingMode).includes(config.renderingMode)) {
                    this._config.renderingMode = config.renderingMode;
                } else {
                    log(
                        'FOARenderer: Invalid rendering mode order. (got' +
                        config.renderingMode + ') Fallbacks to the mode "ambisonic".');
                }
            }
        }

        this._buildAudioGraph();

        this._tempMatrix4 = new Float32Array(16);
    }


    /**
     * Builds the internal audio graph.
     * @private
     */
    _buildAudioGraph() {
        this.input = this._context.createGain();
        this.output = this._context.createGain();
        this._bypass = this._context.createGain();
        this._foaRouter = new FOARouter(this._context, this._config.channelMap);
        this._foaRotator = new FOARotator(this._context);
        this._foaConvolver = new FOAConvolver(this._context);
        this.input.connect(this._foaRouter.input);
        this.input.connect(this._bypass);
        this._foaRouter.output.connect(this._foaRotator.input);
        this._foaRotator.output.connect(this._foaConvolver.input);
        this._foaConvolver.output.connect(this.output);

        this.input.channelCount = 4;
        this.input.channelCountMode = 'explicit';
        this.input.channelInterpretation = 'discrete';
    }

    dipose() {
        if (this.getRenderingMode() === RenderingMode.BYPASS) {
            this._bypass.connect(this.output);
        }

        this.input.disconnect(this._foaRouter.input);
        this.input.disconnect(this._bypass);
        this._foaRouter.output.disconnect(this._foaRotator.input);
        this._foaRotator.output.disconnect(this._foaConvolver.input);
        this._foaConvolver.output.disconnect(this.output);
        this._foaConvolver.dispose();
        this._foaRotator.dispose();
        this._foaRouter.dipose();
    }

    /**
     * Initializes and loads the resource for the renderer.
     * @return {Promise}
     */
    async initialize() {
        log(
            'FOARenderer: Initializing... (mode: ' + this._config.renderingMode +
            ')');

        const bufferList = this._config.pathList
            ? new BufferList(this._context, this._config.pathList, { dataType: 'url' })
            : new BufferList(this._context, OmnitoneFOAHrirBase64);
        try {
            const hrirBufferList = await bufferList.load();
            this._foaConvolver.setHRIRBufferList(hrirBufferList);
            this.setRenderingMode(this._config.renderingMode);
            log('FOARenderer: HRIRs loaded successfully. Ready.');
        }
        catch (exp) {
            const errorMessage = 'FOARenderer: HRIR loading/decoding failed. Reason: ' + exp.message;
            throwError(errorMessage);
        }
    }


    /**
     * Set the channel map.
     * @param {Number[]} channelMap - Custom channel routing for FOA stream.
     */
    setChannelMap(channelMap) {
        if (channelMap.toString() !== this._config.channelMap.toString()) {
            log(
                'Remapping channels ([' + this._config.channelMap.toString() +
                '] -> [' + channelMap.toString() + ']).');
            this._config.channelMap = channelMap.slice();
            this._foaRouter.setChannelMap(this._config.channelMap);
        }
    }


    /**
     * Updates the rotation matrix with 3x3 matrix.
     * @param {Number[]} rotationMatrix3 - A 3x3 rotation matrix. (column-major)
     */
    setRotationMatrix3(rotationMatrix3) {
        this._foaRotator.setRotationMatrix3(rotationMatrix3);
    }


    /**
     * Updates the rotation matrix with 4x4 matrix.
     * @param {Number[]} rotationMatrix4 - A 4x4 rotation matrix. (column-major)
     */
    setRotationMatrix4(rotationMatrix4) {
        this._foaRotator.setRotationMatrix4(rotationMatrix4);
    }

    getRenderingMode() {
        return this._config.renderingMode;
    }

    /**
     * Set the rendering mode.
     * @param {RenderingMode} mode - Rendering mode.
     *  - 'ambisonic': activates the ambisonic decoding/binaurl rendering.
     *  - 'bypass': bypasses the input stream directly to the output. No ambisonic
     *    decoding or encoding.
     *  - 'off': all the processing off saving the CPU power.
     */
    setRenderingMode(mode) {
        if (mode === this._config.renderingMode) {
            return;
        }

        switch (mode) {
            case RenderingMode.AMBISONIC:
                this._foaConvolver.enable();
                this._bypass.disconnect();
                break;
            case RenderingMode.BYPASS:
                this._foaConvolver.disable();
                this._bypass.connect(this.output);
                break;
            case RenderingMode.OFF:
                this._foaConvolver.disable();
                this._bypass.disconnect();
                break;
            default:
                log(
                    'FOARenderer: Rendering mode "' + mode + '" is not ' +
                    'supported.');
                return;
        }

        this._config.renderingMode = mode;
        log('FOARenderer: Rendering mode changed. (' + mode + ')');
    }
}

/**
 * @license
 * Copyright 2017 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */


/**
 * @file A collection of convolvers. Can be used for the optimized HOA binaural
 * rendering. (e.g. SH-MaxRe HRTFs)
 */


/**
 * A convolver network for N-channel HOA stream.
 */
class HOAConvolver {
    /**
     * A convolver network for N-channel HOA stream.
      * @param {AudioContext} context - Associated AudioContext.
     * @param {Number} ambisonicOrder - Ambisonic order. (2 or 3)
     * @param {AudioBuffer[]} [hrirBufferList] - An ordered-list of stereo
     * AudioBuffers for convolution. (SOA: 5 AudioBuffers, TOA: 8 AudioBuffers)
     */
    constructor(context, ambisonicOrder, hrirBufferList) {
        this._context = context;

        this._active = false;
        this._isBufferLoaded = false;

        // The number of channels K based on the ambisonic order N where K = (N+1)^2.
        this._ambisonicOrder = ambisonicOrder;
        this._numberOfChannels =
            (this._ambisonicOrder + 1) * (this._ambisonicOrder + 1);

        this._buildAudioGraph();
        if (hrirBufferList) {
            this.setHRIRBufferList(hrirBufferList);
        }

        this.enable();
    }


    /**
     * Build the internal audio graph.
     * For TOA convolution:
     *   input -> splitter(16) -[0,1]-> merger(2) -> convolver(2) -> splitter(2)
     *                         -[2,3]-> merger(2) -> convolver(2) -> splitter(2)
     *                         -[4,5]-> ... (6 more, 8 branches total)
     * @private
     */
    _buildAudioGraph() {
        const numberOfStereoChannels = Math.ceil(this._numberOfChannels / 2);

        this._inputSplitter =
            this._context.createChannelSplitter(this._numberOfChannels);
        this._stereoMergers = [];
        this._convolvers = [];
        this._stereoSplitters = [];
        this._positiveIndexSphericalHarmonics = this._context.createGain();
        this._negativeIndexSphericalHarmonics = this._context.createGain();
        this._inverter = this._context.createGain();
        this._binauralMerger = this._context.createChannelMerger(2);
        this._outputGain = this._context.createGain();

        for (let i = 0; i < numberOfStereoChannels; ++i) {
            this._stereoMergers[i] = this._context.createChannelMerger(2);
            this._convolvers[i] = this._context.createConvolver();
            this._stereoSplitters[i] = this._context.createChannelSplitter(2);
            this._convolvers[i].normalize = false;
        }

        for (let l = 0; l <= this._ambisonicOrder; ++l) {
            for (let m = -l; m <= l; m++) {
                // We compute the ACN index (k) of ambisonics channel using the degree (l)
                // and index (m): k = l^2 + l + m
                const acnIndex = l * l + l + m;
                const stereoIndex = Math.floor(acnIndex / 2);

                // Split channels from input into array of stereo convolvers.
                // Then create a network of mergers that produces the stereo output.
                this._inputSplitter.connect(
                    this._stereoMergers[stereoIndex], acnIndex, acnIndex % 2);
                this._stereoMergers[stereoIndex].connect(this._convolvers[stereoIndex]);
                this._convolvers[stereoIndex].connect(this._stereoSplitters[stereoIndex]);

                // Positive index (m >= 0) spherical harmonics are symmetrical around the
                // front axis, while negative index (m < 0) spherical harmonics are
                // anti-symmetrical around the front axis. We will exploit this symmetry
                // to reduce the number of convolutions required when rendering to a
                // symmetrical binaural renderer.
                if (m >= 0) {
                    this._stereoSplitters[stereoIndex].connect(
                        this._positiveIndexSphericalHarmonics, acnIndex % 2);
                } else {
                    this._stereoSplitters[stereoIndex].connect(
                        this._negativeIndexSphericalHarmonics, acnIndex % 2);
                }
            }
        }

        this._positiveIndexSphericalHarmonics.connect(this._binauralMerger, 0, 0);
        this._positiveIndexSphericalHarmonics.connect(this._binauralMerger, 0, 1);
        this._negativeIndexSphericalHarmonics.connect(this._binauralMerger, 0, 0);
        this._negativeIndexSphericalHarmonics.connect(this._inverter);
        this._inverter.connect(this._binauralMerger, 0, 1);

        // For asymmetric index.
        this._inverter.gain.value = -1;

        // Input/Output proxy.
        this.input = this._inputSplitter;
        this.output = this._outputGain;
    }

    dispose() {
        if (this._active) {
            this.disable();
        }


        for (let l = 0; l <= this._ambisonicOrder; ++l) {
            for (let m = -l; m <= l; m++) {
                // We compute the ACN index (k) of ambisonics channel using the degree (l)
                // and index (m): k = l^2 + l + m
                const acnIndex = l * l + l + m;
                const stereoIndex = Math.floor(acnIndex / 2);

                // Split channels from input into array of stereo convolvers.
                // Then create a network of mergers that produces the stereo output.
                this._inputSplitter.disconnect(
                    this._stereoMergers[stereoIndex], acnIndex, acnIndex % 2);
                this._stereoMergers[stereoIndex].disconnect(this._convolvers[stereoIndex]);
                this._convolvers[stereoIndex].disconnect(this._stereoSplitters[stereoIndex]);

                // Positive index (m >= 0) spherical harmonics are symmetrical around the
                // front axis, while negative index (m < 0) spherical harmonics are
                // anti-symmetrical around the front axis. We will exploit this symmetry
                // to reduce the number of convolutions required when rendering to a
                // symmetrical binaural renderer.
                if (m >= 0) {
                    this._stereoSplitters[stereoIndex].disconnect(
                        this._positiveIndexSphericalHarmonics, acnIndex % 2);
                } else {
                    this._stereoSplitters[stereoIndex].disconnect(
                        this._negativeIndexSphericalHarmonics, acnIndex % 2);
                }
            }
        }

        this._positiveIndexSphericalHarmonics.disconnect(this._binauralMerger, 0, 0);
        this._positiveIndexSphericalHarmonics.disconnect(this._binauralMerger, 0, 1);
        this._negativeIndexSphericalHarmonics.disconnect(this._binauralMerger, 0, 0);
        this._negativeIndexSphericalHarmonics.disconnect(this._inverter);
        this._inverter.disconnect(this._binauralMerger, 0, 1);

    }


    /**
     * Assigns N HRIR AudioBuffers to N convolvers: Note that we use 2 stereo
     * convolutions for 4-channel direct convolution. Using mono convolver or
     * 4-channel convolver is not viable because mono convolution wastefully
     * produces the stereo outputs, and the 4-ch convolver does cross-channel
     * convolution. (See Web Audio API spec)
     * @param {AudioBuffer[]} hrirBufferList - An array of stereo AudioBuffers for
     * convolvers.
     */
    setHRIRBufferList(hrirBufferList) {
        // After these assignments, the channel data in the buffer is immutable in
        // FireFox. (i.e. neutered) So we should avoid re-assigning buffers, otherwise
        // an exception will be thrown.
        if (this._isBufferLoaded) {
            return;
        }

        for (let i = 0; i < hrirBufferList.length; ++i) {
            this._convolvers[i].buffer = hrirBufferList[i];
        }

        this._isBufferLoaded = true;
    }


    /**
     * Enable HOAConvolver instance. The audio graph will be activated and pulled by
     * the WebAudio engine. (i.e. consume CPU cycle)
     */
    enable() {
        this._binauralMerger.connect(this._outputGain);
        this._active = true;
    }


    /**
     * Disable HOAConvolver instance. The inner graph will be disconnected from the
     * audio destination, thus no CPU cycle will be consumed.
     */
    disable() {
        this._binauralMerger.disconnect();
        this._active = false;
    }
}

/**
 * @license
 * Copyright 2016 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @file Sound field rotator for higher-order-ambisonics decoding.
 */


/**
 * Kronecker Delta function.
 * @param {Number} i
 * @param {Number} j
 * @return {Number}
 */
function getKroneckerDelta(i, j) {
    return i === j ? 1 : 0;
}

/**
  * @param {Number} l
 * @param {Number} i
 * @param {Number} j
 * @param {Number} index
 */
function lij2i(l, i, j) {
    const index = (j + l) * (2 * l + 1) + (i + l);
    return index;
}

/**
 * A helper function to allow us to access a matrix array in the same
 * manner, assuming it is a (2l+1)x(2l+1) matrix. [2] uses an odd convention of
 * referring to the rows and columns using centered indices, so the middle row
 * and column are (0, 0) and the upper left would have negative coordinates.
 * @param {Number[]} matrix - N matrices of gainNodes, each with (2n+1) x (2n+1)
 * elements, where n=1,2,...,N.
 * @param {Number} l
 * @param {Number} i
 * @param {Number} j
 * @param {Number} gainValue
 */
function setCenteredElement(matrix, l, i, j, gainValue) {
    const index = lij2i(l, i, j);
    // Row-wise indexing.
    matrix[l - 1][index].gain.value = gainValue;
}


/**
 * This is a helper function to allow us to access a matrix array in the same
 * manner, assuming it is a (2l+1) x (2l+1) matrix.
 * @param {Number[]} matrix - N matrices of gainNodes, each with (2n+1) x (2n+1)
 * elements, where n=1,2,...,N.
 * @param {Number} l
 * @param {Number} i
 * @param {Number} j
 * @return {Number}
 */
function getCenteredElement(matrix, l, i, j) {
    // Row-wise indexing.
    const index = lij2i(l, i, j);
    return matrix[l - 1][index].gain.value;
}


/**
 * Helper function defined in [2] that is used by the functions U, V, W.
 * This should not be called on its own, as U, V, and W (and their coefficients)
 * select the appropriate matrix elements to access arguments |a| and |b|.
 * @param {Number[]} matrix - N matrices of gainNodes, each with (2n+1) x (2n+1)
 * elements, where n=1,2,...,N.
 * @param {Number} i
 * @param {Number} a
 * @param {Number} b
 * @param {Number} l
 * @return {Number}
 */
function getP(matrix, i, a, b, l) {
    if (b === l) {
        return getCenteredElement(matrix, 1,     i,      1) *
               getCenteredElement(matrix, l - 1, a,  l - 1) -
               getCenteredElement(matrix, 1,     i,     -1) *
               getCenteredElement(matrix, l - 1, a, -l + 1);
    } else if (b === -l) {
        return getCenteredElement(matrix, 1,     i,      1) *
               getCenteredElement(matrix, l - 1, a, -l + 1) +
               getCenteredElement(matrix, 1,     i,     -1) *
               getCenteredElement(matrix, l - 1, a,  l - 1);
    } else {
        return getCenteredElement(matrix, 1,     i, 0) *
               getCenteredElement(matrix, l - 1, a, b);
    }
}


/**
 * The functions U, V, and W should only be called if the correspondingly
 * named coefficient u, v, w from the function ComputeUVWCoeff() is non-zero.
 * When the coefficient is 0, these would attempt to access matrix elements that
 * are out of bounds. The vector of rotations, |r|, must have the |l - 1|
 * previously completed band rotations. These functions are valid for |l >= 2|.
 * @param {Number[]} matrix - N matrices of gainNodes, each with (2n+1) x (2n+1)
 * elements, where n=1,2,...,N.
 * @param {Number} m
 * @param {Number} n
 * @param {Number} l
 * @return {Number}
 */
function getU(matrix, m, n, l) {
    // Although [1, 2] split U into three cases for m == 0, m < 0, m > 0
    // the actual values are the same for all three cases.
    return getP(matrix, 0, m, n, l);
}


/**
 * The functions U, V, and W should only be called if the correspondingly
 * named coefficient u, v, w from the function ComputeUVWCoeff() is non-zero.
 * When the coefficient is 0, these would attempt to access matrix elements that
 * are out of bounds. The vector of rotations, |r|, must have the |l - 1|
 * previously completed band rotations. These functions are valid for |l >= 2|.
 * @param {Number[]} matrix - N matrices of gainNodes, each with (2n+1) x (2n+1)
 * elements, where n=1,2,...,N.
 * @param {Number} m
 * @param {Number} n
 * @param {Number} l
 * @return {Number}
 */
function getV(matrix, m, n, l) {
    if (m === 0) {
        return getP(matrix, 1, 1, n, l) +
               getP(matrix, -1, -1, n, l);
    } else if (m > 0) {
        const d = getKroneckerDelta(m, 1);
        return getP(matrix,  1,  m - 1, n, l) * Math.sqrt(1 + d) -
               getP(matrix, -1, -m + 1, n, l) * (1 - d);
    } else {
        // Note there is apparent errata in [1,2,2b] dealing with this particular
        // case. [2b] writes it should be P*(1-d)+P*(1-d)^0.5
        // [1] writes it as P*(1+d)+P*(1-d)^0.5, but going through the math by hand,
        // you must have it as P*(1-d)+P*(1+d)^0.5 to form a 2^.5 term, which
        // parallels the case where m > 0.
        const d = getKroneckerDelta(m, -1);
        return getP(matrix,  1,  m + 1, n, l) * (1 - d) +
               getP(matrix, -1, -m - 1, n, l) * Math.sqrt(1 + d);
    }
}


/**
 * The functions U, V, and W should only be called if the correspondingly
 * named coefficient u, v, w from the function ComputeUVWCoeff() is non-zero.
 * When the coefficient is 0, these would attempt to access matrix elements that
 * are out of bounds. The vector of rotations, |r|, must have the |l - 1|
 * previously completed band rotations. These functions are valid for |l >= 2|.
 * @param {Number[]} matrix N matrices of gainNodes, each with (2n+1) x (2n+1)
 * elements, where n=1,2,...,N.
 * @param {Number} m
 * @param {Number} n
 * @param {Number} l
 * @return {Number}
 */
function getW(matrix, m, n, l) {
    // Whenever this happens, w is also 0 so W can be anything.
    if (m === 0) {
        return 0;
    }

    return m > 0 ?
        getP(matrix, 1, m + 1, n, l) + getP(matrix, -1, -m - 1, n, l) :
        getP(matrix, 1, m - 1, n, l) - getP(matrix, -1, -m + 1, n, l);
}


/**
 * Calculates the coefficients applied to the U, V, and W functions. Because
 * their equations share many common terms they are computed simultaneously.
 * @param {Number} m
 * @param {Number} n
 * @param {Number} l
 * @return {Number[]} 3 coefficients for U, V and W functions.
 */
function computeUVWCoeff(m, n, l) {
    const d = getKroneckerDelta(m, 0);
    const reciprocalDenominator =
        Math.abs(n) === l ? 1 / (2 * l * (2 * l - 1)) : 1 / ((l + n) * (l - n));

    return [
        Math.sqrt((l + m) * (l - m) * reciprocalDenominator),
        0.5 * (1 - 2 * d) * Math.sqrt((1 + d) *
            (l + Math.abs(m) - 1) *
            (l + Math.abs(m)) *
            reciprocalDenominator),
        -0.5 * (1 - d) * Math.sqrt((l - Math.abs(m) - 1) * (l - Math.abs(m))) *
        reciprocalDenominator,
    ];
}


/**
 * Calculates the (2l+1) x (2l+1) rotation matrix for the band l.
 * This uses the matrices computed for band 1 and band l-1 to compute the
 * matrix for band l. |rotations| must contain the previously computed l-1
 * rotation matrices.
 * This implementation comes from p. 5 (6346), Table 1 and 2 in [2] taking
 * into account the corrections from [2b].
 * @param {Number[]} matrix - N matrices of gainNodes, each with where
 * n=1,2,...,N.
 * @param {Number} l
 */
function computeBandRotation(matrix, l) {
    // The lth band rotation matrix has rows and columns equal to the number of
    // coefficients within that band (-l <= m <= l implies 2l + 1 coefficients).
    for (let m = -l; m <= l; m++) {
        for (let n = -l; n <= l; n++) {
            const uvwCoefficients = computeUVWCoeff(m, n, l);

            // The functions U, V, W are only safe to call if the coefficients
            // u, v, w are not zero.
            if (Math.abs(uvwCoefficients[0]) > 0) {
                uvwCoefficients[0] *= getU(matrix, m, n, l);
            }
            if (Math.abs(uvwCoefficients[1]) > 0) {
                uvwCoefficients[1] *= getV(matrix, m, n, l);
            }
            if (Math.abs(uvwCoefficients[2]) > 0) {
                uvwCoefficients[2] *= getW(matrix, m, n, l);
            }

            setCenteredElement(
                matrix, l, m, n,
                uvwCoefficients[0] + uvwCoefficients[1] + uvwCoefficients[2]);
        }
    }
}


/**
 * Compute the HOA rotation matrix after setting the transform matrix.
 * @param {Number[]} matrix - N matrices of gainNodes, each with (2n+1) x (2n+1)
 * elements, where n=1,2,...,N.
 */
function computeHOAMatrices(matrix) {
    // We start by computing the 2nd-order matrix from the 1st-order matrix.
    for (let i = 2; i <= matrix.length; i++) {
        computeBandRotation(matrix, i);
    }
}


/**
 * Higher-order-ambisonic decoder based on gain node network. We expect
 * the order of the channels to conform to ACN ordering. Below are the helper
 * methods to compute SH rotation using recursion. The code uses maths described
 * in the following papers:
 *  [1] R. Green, "Spherical Harmonic Lighting: The Gritty Details", GDC 2003,
 *      http://www.research.scea.com/gdc2003/spherical-harmonic-lighting.pdf
 *  [2] J. Ivanic and K. Ruedenberg, "Rotation Matrices for Real
 *      Spherical Harmonics. Direct Determination by Recursion", J. Phys.
 *      Chem., vol. 100, no. 15, pp. 6342-6347, 1996.
 *      http://pubs.acs.org/doi/pdf/10.1021/jp953350u
 *  [2b] Corrections to initial publication:
 *       http://pubs.acs.org/doi/pdf/10.1021/jp9833350
 */
class HOARotator {

    /**
     * Higher-order-ambisonic decoder based on gain node network. We expect
     * the order of the channels to conform to ACN ordering. Below are the helper
     * methods to compute SH rotation using recursion. The code uses maths described
     * in the following papers:
     *  [1] R. Green, "Spherical Harmonic Lighting: The Gritty Details", GDC 2003,
     *      http://www.research.scea.com/gdc2003/spherical-harmonic-lighting.pdf
     *  [2] J. Ivanic and K. Ruedenberg, "Rotation Matrices for Real
     *      Spherical Harmonics. Direct Determination by Recursion", J. Phys.
     *      Chem., vol. 100, no. 15, pp. 6342-6347, 1996.
     *      http://pubs.acs.org/doi/pdf/10.1021/jp953350u
     *  [2b] Corrections to initial publication:
     *       http://pubs.acs.org/doi/pdf/10.1021/jp9833350
     * @param {AudioContext} context - Associated AudioContext.
     * @param {Number} ambisonicOrder - Ambisonic order.
     */
    constructor(context, ambisonicOrder) {
        this._context = context;
        this._ambisonicOrder = ambisonicOrder;

        // We need to determine the number of channels K based on the ambisonic order
        // N where K = (N + 1)^2.
        const numberOfChannels = (ambisonicOrder + 1) * (ambisonicOrder + 1);

        this._splitter = this._context.createChannelSplitter(numberOfChannels);
        this._merger = this._context.createChannelMerger(numberOfChannels);

        // Create a set of per-order rotation matrices using gain nodes.
        /** @type {GainNode[][]} */
        this._gainNodeMatrix = [];

        for (let i = 1; i <= ambisonicOrder; i++) {
            // Each ambisonic order requires a separate (2l + 1) x (2l + 1) rotation
            // matrix. We compute the offset value as the first channel index of the
            // current order where
            //   k_last = l^2 + l + m,
            // and m = -l
            //   k_last = l^2
            const orderOffset = i * i;

            // Uses row-major indexing.
            const rows = (2 * i + 1);

            this._gainNodeMatrix[i - 1] = [];
            for (let j = 0; j < rows; j++) {
                const inputIndex = orderOffset + j;
                for (let k = 0; k < rows; k++) {
                    const outputIndex = orderOffset + k;
                    const matrixIndex = j * rows + k;
                    this._gainNodeMatrix[i - 1][matrixIndex] = this._context.createGain();
                    this._splitter.connect(
                        this._gainNodeMatrix[i - 1][matrixIndex], inputIndex);
                    this._gainNodeMatrix[i - 1][matrixIndex].connect(
                        this._merger, 0, outputIndex);
                }
            }
        }

        // W-channel is not involved in rotation, skip straight to ouput.
        this._splitter.connect(this._merger, 0, 0);

        // Default Identity matrix.
        this.setRotationMatrix3(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]));

        // Input/Output proxy.
        this.input = this._splitter;
        this.output = this._merger;
    }

    dispose() {
        for (let i = 1; i <= this._ambisonicOrder; i++) {
            // Each ambisonic order requires a separate (2l + 1) x (2l + 1) rotation
            // matrix. We compute the offset value as the first channel index of the
            // current order where
            //   k_last = l^2 + l + m,
            // and m = -l
            //   k_last = l^2
            const orderOffset = i * i;

            // Uses row-major indexing.
            const rows = (2 * i + 1);

            for (let j = 0; j < rows; j++) {
                const inputIndex = orderOffset + j;
                for (let k = 0; k < rows; k++) {
                    const outputIndex = orderOffset + k;
                    const matrixIndex = j * rows + k;
                    this._splitter.disconnect(
                        this._gainNodeMatrix[i - 1][matrixIndex], inputIndex);
                    this._gainNodeMatrix[i - 1][matrixIndex].disconnect(
                        this._merger, 0, outputIndex);
                }
            }
        }

        // W-channel is not involved in rotation, skip straight to ouput.
        this._splitter.disconnect(this._merger, 0, 0);
    }


    /**
     * Updates the rotation matrix with 3x3 matrix.
     * @param {Number[]} rotationMatrix3 - A 3x3 rotation matrix. (column-major)
     */
    setRotationMatrix3(rotationMatrix3) {
        this._gainNodeMatrix[0][0].gain.value = rotationMatrix3[0];
        this._gainNodeMatrix[0][1].gain.value = rotationMatrix3[1];
        this._gainNodeMatrix[0][2].gain.value = rotationMatrix3[2];
        this._gainNodeMatrix[0][3].gain.value = rotationMatrix3[3];
        this._gainNodeMatrix[0][4].gain.value = rotationMatrix3[4];
        this._gainNodeMatrix[0][5].gain.value = rotationMatrix3[5];
        this._gainNodeMatrix[0][6].gain.value = rotationMatrix3[6];
        this._gainNodeMatrix[0][7].gain.value = rotationMatrix3[7];
        this._gainNodeMatrix[0][8].gain.value = rotationMatrix3[8];
        computeHOAMatrices(this._gainNodeMatrix);
    }


    /**
     * Updates the rotation matrix with 4x4 matrix.
     * @param {Number[]} rotationMatrix4 - A 4x4 rotation matrix. (column-major)
     */
    setRotationMatrix4(rotationMatrix4) {
        this._gainNodeMatrix[0][0].gain.value = rotationMatrix4[0];
        this._gainNodeMatrix[0][1].gain.value = rotationMatrix4[1];
        this._gainNodeMatrix[0][2].gain.value = rotationMatrix4[2];
        this._gainNodeMatrix[0][3].gain.value = rotationMatrix4[4];
        this._gainNodeMatrix[0][4].gain.value = rotationMatrix4[5];
        this._gainNodeMatrix[0][5].gain.value = rotationMatrix4[6];
        this._gainNodeMatrix[0][6].gain.value = rotationMatrix4[8];
        this._gainNodeMatrix[0][7].gain.value = rotationMatrix4[9];
        this._gainNodeMatrix[0][8].gain.value = rotationMatrix4[10];
        computeHOAMatrices(this._gainNodeMatrix);
    }


    /**
     * Returns the current 3x3 rotation matrix.
     * @return {Number[]} - A 3x3 rotation matrix. (column-major)
     */
    getRotationMatrix3() {
        const rotationMatrix3 = new Float32Array(9);
        rotationMatrix3[0] = this._gainNodeMatrix[0][0].gain.value;
        rotationMatrix3[1] = this._gainNodeMatrix[0][1].gain.value;
        rotationMatrix3[2] = this._gainNodeMatrix[0][2].gain.value;
        rotationMatrix3[3] = this._gainNodeMatrix[0][3].gain.value;
        rotationMatrix3[4] = this._gainNodeMatrix[0][4].gain.value;
        rotationMatrix3[5] = this._gainNodeMatrix[0][5].gain.value;
        rotationMatrix3[6] = this._gainNodeMatrix[0][6].gain.value;
        rotationMatrix3[7] = this._gainNodeMatrix[0][7].gain.value;
        rotationMatrix3[8] = this._gainNodeMatrix[0][8].gain.value;
        return rotationMatrix3;
    }


    /**
     * Returns the current 4x4 rotation matrix.
     * @return {Number[]} - A 4x4 rotation matrix. (column-major)
     */
    getRotationMatrix4() {
        const rotationMatrix4 = new Float32Array(16);
        rotationMatrix4[0] = this._gainNodeMatrix[0][0].gain.value;
        rotationMatrix4[1] = this._gainNodeMatrix[0][1].gain.value;
        rotationMatrix4[2] = this._gainNodeMatrix[0][2].gain.value;
        rotationMatrix4[4] = this._gainNodeMatrix[0][3].gain.value;
        rotationMatrix4[5] = this._gainNodeMatrix[0][4].gain.value;
        rotationMatrix4[6] = this._gainNodeMatrix[0][5].gain.value;
        rotationMatrix4[8] = this._gainNodeMatrix[0][6].gain.value;
        rotationMatrix4[9] = this._gainNodeMatrix[0][7].gain.value;
        rotationMatrix4[10] = this._gainNodeMatrix[0][8].gain.value;
        return rotationMatrix4;
    }


    /**
     * Get the current ambisonic order.
     * @return {Number}
     */
    getAmbisonicOrder() {
        return this._ambisonicOrder;
    }
}

const OmnitoneTOAHrirBase64 = [
"UklGRiQEAABXQVZFZm10IBAAAAABAAIAgLsAAADuAgAEABAAZGF0YQAEAAD+/wQA8/8YAP3/CgACAAAA//8CAAYA8/8AAPH/CgDv/97/e/+y/9P+UQDwAHUBEwV7/pP8P/y09bsDwAfNBGYIFf/Y+736+fP890Hv8AGcC3T/vwYy+S70AAICA3AD4AagBw0R4w3ZEAcN8RVYAV8Q8P2z+kECHwdK/jIG0QNKAYUElf8IClj7BgjX+/f8j/l3/5f/6fkK+xz8FP0v/nj/Mf/n/FcBPfvH/1H3+gBP/Hf8cfiCAR/54QBh+UQAcvkzAWL8TP13+iD/V/73+wv9Kv+Y/hv+xPz7/UL83//a/z/9AP6R/5L+jf26/P3+rP26/tD8nP7B/Pv+WP1V/sP9gv91/3P9xP3J/nv/GP5S/sb+IP8v/9j/dv7U/pr+6v+u/Z3/sv5cAOr9Q/83/+n/zP5x/57+2//k/nwA/v01//L+SACB/sD/Ff81AJT+TgDp/ocAm/5dAFT+MgD+/pMAW/7o/yH/xQDA/kkA9P6LAL3+pAC0/iQAz/5UALD+UwAt/3UAhf4UAA//pwC+/joAz/5aAAv/fwDY/iMAIf+uAPP+ZAAc/0QAy/4xAB7/TgDs/goADP8wAEL/NwDo/ub/Uf9BAC3/+v9F/y4ARP9HAFP/EQA3/xMATP81AG3/HQAu/wgAaP9FACb/9f9B/y0AUP8rAED/CwBV/z4AW/8TAGH/BQBK/xsAfv8eAFn/AgB3/zwAff8RAGj//v+E/yAAb//0/3n/FwBz/xcAiv8PAHn/FQCJ/xgAg//x/3j/EQCa/ycAff/w/47/HwCI//X/iv/7/43/JQCM/+n/kP8AAJb/JACj//7/oP8ZAML/SwCo/w4Atv8tAMb/PACr/xcAwP9HAMP/OADF/y4A0f9IANL/NwC//zEA0f9LAMb/MAC8/y4A3f9GAMH/FQDQ/yYA2/8sAMT/AwDX/xkA3v8SAM3/9v/c/w8A4f8LAMj/8f/h/xQA2P8CAMn/8//j/xQA0v/7/9H//P/i/xEA0v/1/9L//f/j/w0A0f/x/9f//v/k/wgAz//u/9z/AwDg/wMA0P/v/9//BQDf////0v/y/+D/CADc//3/0v/2/+L/CgDa//r/1v/5/+T/CgDY//j/2f/9/+T/CADY//f/3P8AAOT/BwDY//f/4P8EAOP/BADZ//j/4v8GAOL/AwDa//r/5f8IAOH/AQDc//3/5v8JAOD//v/f////5v8IAOD//v/h/wIA5/8HAOD//f/j/wMA5/8GAOD//f/l/wYA5v8EAOD//v/m/wYA5f8CAOL////n/wYA5P8BAOH/AADl/wUA4f///+H/AQDk/wMA4f///+T/AQDm/wEA5////+r/AADt/wAA7/////P/AAD1////",
"UklGRiQEAABXQVZFZm10IBAAAAABAAIAgLsAAADuAgAEABAAZGF0YQAEAAD//////v///wAAAAAAAAAAAQAAAAAA///9/wAABAD+//n/AgAJAAAA+v/+//f/DAAdAPv/+v+l/8L+jf/4/vgAdwVPAQACLQBo+Qj/Ev7o/N3/VgCbA08Bxf+L+yn9J/2HCU8FmgBvDe30Rv5h/LT09gi5CxkA5gOi8/30kwEM+4YJMf2nBmkJJAQQBLoFtvvv+m4A7PF6/R0Bif3qAuf8WARAAf4GyABG/BIAwvr4Acv8U//c/yIC8AEn/B8Daf2CAgMBAf3MAN38vgLK/UT/QwCyAPYClPyvAW/+pQAoASD+zP+R/IYC1f7C/nEBQP96AZb+1QAIAM//yQE7/tkAZ/7TAXL/w/8+AIsAtwB7/24A4v9a/z4A7v4iADb/dwCj/23/kgBOANUAIv8lAKEAxP9gAK7/BwCP/5kA7/9v/0wAzv9DAGT/3/9vAHv/6P+q/xUA7P8XAO//uv/g/2UAEgCV/wEATADM/+7/+//j/+D/9v/i//j/IgD+/xoAxf/6/z4A5/+8/9D/QwDq/+3/OQDT/zUAIgA/APP/PgAjAPD/BwAGACAADAC3//b/HAA3AN//RgDN/w8AIAACAN//GQBDACEAIwA+ACoAJQAeAPz/KgAYAPr/DgAEABYAIgAcAMT/7f8OAOL/5P/2//L/9P8GAPT/7v/8/+7/6v/t//z/AgAUAOL//P8VAAMA4/8IAPb/+P8MAAoA5v8NAAsA9v///wEAAAD9//n/9/8JAAYA7v/6/wMA+f8GAAEA7f/7/xgACAD4/w8A///3/w0A+f8BAAIA/P/5/xIA///9//r/7v/+/xYACQD///H/CwDz/wEADgAHAPP/FADn/+3/AQD5//f/AgD7/wEABwAMAAEADQD8//n/8f8OAPX/BAD+//X/+v8WAAQA+f8CAAEA7/8QAAEA/P8DAAUA9f8KAAwA9v8DAAUA+f8OAAoA9f/7/w0A+v8EAAgA8P/6/woA+//8/wkA+P/3/woA+//8/wcA9//1/woAAwD5/wcA/P/3/w0AAwD3/wEABAD2/wkABgD3/wEABQD3/wUABQD3//v/BwD3/wMABQD3//r/CQD7////BQD6//n/CQD9//3/BAD9//j/BwAAAPv/AwD///j/BwABAPn/AQABAPn/BQACAPn///8DAPr/AwADAPr//v8EAPv/AQADAPv//P8FAP3///8DAPz/+/8FAP7//f8CAP7/+/8EAP///P8BAP//+/8DAAEA+/8AAAEA+/8CAAIA+////wIA/f8AAAIA/P/+/wIA/f8AAAIA/f/9/wMA/////wEA///+/wIA/////wAAAAD+/wAAAAD/////AAD//wAA//8AAP//AAD//wAA",
"UklGRiQEAABXQVZFZm10IBAAAAABAAIAgLsAAADuAgAEABAAZGF0YQAEAAD////////+//////8AAP////8AAP//AAAAAPz//f8IAAMA9////w4AAQD6/wwA8//+/y8Afv/0/2H/UP5gAbH+2QG1B2cAVAIh/l32FPyM/nACPQDV/+UEo/Q6AQwCu/oLD9kF8QJA/Uz+Wf2KCOcC+wUKBsL5aQBQ97rwOPiPAvn5CAl8AHEDkQPcAA8Bn/lIAdz7HQF1+xz9cAM4/94E4gDKAun+cgPYAYr9JgJr/bf+ivxz/MoBgv5UA8EBSgAQAJ7/UgEk/cQB7f63/sD/vf4XAhT/BQFCADYAnQGI/9EBtv3hALD/vP+c/3H/TgIN/1sBpf8yAP3/4f8qABr+1f8OAJ3/dwAGADEBnv9JAPz/IQBwAIH/jgAS/4wAsACTAOn/DQDCALn/ZQCSAAIAAwD1/9//jv9aADQA/v9EAB0AfgA8AAQACgB9APr/IAARAPT/5v9xACAABAAHAGUAt/89AC4ACgAjAMP/+v/9/xYA7f/1/+D/7P87AC0Auv8RAAcA9/8FAC8A2//y/xIAEwAaADQAJADp/zoAAgAfABIA2f/e/zUA+P/6/w4A9//A/zcA4//P//T/5f/R////EwDb/w4A8/8BABkANADh/xEA+f/0/wIAHADc//j/GwD1//f/GADs/+v/EAAAAPz/EgD3/+r/FgAMAAkAGAD9/+z/IQAQAPH/GQD3//z/CgAfAOX/AgD8//H/BAATAOv/+v///wIABAAdAOj/BQAPAAcAAQATAOz/8/8JAAkA6f8VAOv/+f8QABUA/v8OAO3/+P8KABUA9f8FAPv/5/8TAA0A7f8XAAkAAQAJABYA4/8WAAcACgANABEA7v8EAP7/AAD+/wMA9//7/xAAAQD8/wQA+f/7/wMABgDq/wAA+v/3/wYACQD1//3/BAD9/wgADgDw//r/AgD6/wEACADv//j/BQD///X/BwDu//j/AgACAPP/BAD2//n/BAAGAPb/BAD8//3/BQAJAPL/AwD+//3/BAAIAPP//f8DAPz/AAAGAPP/+/8CAP7//f8FAPX/+f8DAAAA/P8EAPf/+v8GAAMA+/8EAPv/+/8GAAQA+v8CAP///P8EAAUA+f8AAP///f8CAAUA+P///wEA/v8BAAUA+f/+/wIAAAD//wUA+v/9/wMAAQD9/wQA+//9/wMAAgD8/wMA/P/9/wMAAwD7/wEA/v/+/wIAAwD6/wEA///+/wAABAD6/wAAAQD//wAAAwD7////AQAAAP//AwD8//7/AgABAP3/AgD9//7/AQABAP3/AQD+//7/AAACAPz/AAD+//////8BAP3/AAD//wAA//8BAP7/AAD//wAA/v8AAP7/AAD//wAA//8AAP//",
"UklGRiQEAABXQVZFZm10IBAAAAABAAIAgLsAAADuAgAEABAAZGF0YQAEAAD//////P/9//3//////wAAAAAAAAIAAgACAP//CAAEAEEA//+cAAUAb/8HAAH9+P9eARkAogQUAJn8BwCd/gX/+QQNAKoC9gFdAtb/b/vd/936TP/6AsD/nfqn/un1W/0dA8IEsQLvAJv2bP72+WMAkP8dAcX+nQO2AIr6bP/EABX+NgK/Bdj2IQv2AE4EUAiD/xQAnwIm/B0B/wGNAoH7sQaP/b8CiQakAqD+R/9xA477KQL//6r75v/O/pcCgQCtAiMCBQAkANAARwHf//39hgBl/kUAJgEtAUEATgA/AgoASADK/zUAJv29/vL+l/9c/0cAUwBBAE8A6QE5/87/Wv9NAOf+5v7P/5P/4/9BAKYAQwDD/zYB5v+r/zYATwAp/1v/WQAEAB0AhwA0AA0AIAA3AAEAzv/u/+//5v9m/zwAIADQ/8T/SABiANb/SwAbAFf/MQDX/7L/hP8TAPr/AgAMAAsAHwAZAI3/VgDC/9v/5//x/6P/AwBlAMv/yf82AB4A+P9WAPj/NwDi/1EA0v9JANj/JwAcAAEADABYANj/4f8MAEwAmP82AN//3P8UADYA7//6/wIACADU/ygAyv82AN7/9v/2/ygAxv/9/+3/5//n/zUA6//g/y4ADgD5/wsABwDv/xIADwAGACoAJQD3/zIA+/8FABsAFgDO/zAAHAAIABQALADp/xcACAAAAPH/GADs/wkACQAFAAgAFQDp/wIAHAD1//P/EQDw/+3/GAD9/+f/HAD8//T/DAAQAPH/HwD4//r/DwAPAOj/EQACAOn/DAAXAOX/BAAOANH/9/8MAO//9f8LANT/9f8EAO//6f8NANb/+P8KAOz/5v8MAOD/7f8UAO//7//+//7/9v8YAPj/9f/z/wsA+v8SAPD/+v/x/xYA+f8SAPb/9//3/xEABQACAPn/9//y/xQACQD///b//v/7/xIACQD9//H/AAD7/xEAAgD5//P/AwD9/w8AAgD3//D/BAD//wUA/v/0//D/BgADAAMA/P/2//f/BwAGAP7/+//2//j/CAAFAPv/+f/5//v/BwAHAPn/9//7//7/BQAFAPf/9//+/wEABAACAPf/+P8BAAIAAgAAAPj/9/8CAAMAAAD+//n/+f8EAAQA/v/8//r/+/8EAAMA/P/7//z//P8EAAIA/P/5//7//v8DAAEA+//5//////8CAAAA+//5/wEAAAABAP//+//6/wIAAQD///3//P/7/wMAAQD///3//f/9/wIAAQD9//3//v/9/wMAAQD9//z/AAD//wEAAAD9//z/AAAAAAAA///9//3/AAD//wAA/v////7/AAD//wAA////////AAD//wAA//8AAP//",
"UklGRiQEAABXQVZFZm10IBAAAAABAAIAgLsAAADuAgAEABAAZGF0YQAEAAD+////+f////v//v///wAA/////wUAAQAIAAIABwACAHkATAAOAaMAAf9C/9X6QvwhArAAtghABW37nv/y+0wAWQNcAE8JRwSOC6AEJe8P8S/zrPWaBI/+LQA/+0L+P/4K8AgAb/8uCh78BQtC614GaQWfAin5UfzN8Tf+GQizAZ4MCQMbGJ4BoRS7AvcHyQARA6n9ZwHZ/z4DvwAZAlAB6gbNAS4GFADFATL7E/2K+j37C/xp/SD9Uv0VAOsDs//WAd3+bv7F/f79mP2X/KH+FwC0/1n+VgFcATABHQGaAET+nf8Y/hoAovpqAXj9CQKW/lsCl/4RApj+bAHk/RcAlv4BAG/+DgDi//3/GwAOAEIAq/+y/3z/8v8+/7T/Tv8//27/mgDZ/1sA+P+cAAAA/P/i/yMAi/85AMP/KgDM/9MA9P+QABoA4QAiACwACwBdAP7/TQDb/y0Ayf+SAA0AZwDg/4wA+/8/AAMAgQDp/w0ADAAQAAoANgAgAA4AKABIAB4A4v/3/+f/+v/c/+n/EADn/wgAFAAqAOz/IwDc/9//3f8XAND/2v/a/w0A5v8BANb/9P/m/wAA8P8ZAN3/RwAGAEsABgB/AP7/NAASAEgABAA3AP3/KgD9/1sA8P8lAOr/FgD1/xAA4/8kAOv/AwD4/xEA5f8NAPT/+v/3/x8A7f8PAPj/IwD5/yAA9/8ZAAEAGgD4/xoA9f8HAAMACAD0/xgA+P8AAPr/IQDp/w4A8v8HAPX/IgD1/wYA+P8GAPX/GgD3/woABQASAAcAGQDw/+v/9P8bAP3/HADs/+f/7/8LAPr//v/0//T/AgD2/wsA6P///+P/CADY//7/5v/3/wQA/v8LAPD/GgD1/yMA/P8QAOv/LADw/yQA+P8XAO7/MQD9/yEAAQAcAPD/IgD9/xMA+/8OAO//FQABAAoA+/8PAPP/FQABAAQA9/8PAPX/CAADAAEA+P8NAPv/CAAGAAUA9/8JAP//AAAFAPz/+f8HAAQA/f8FAP3//P8FAAYA+P8DAP7/+/8AAAcA9/8BAP///f///wgA9//+/wAA/v/8/wUA9//8/wIA///7/wUA+v/7/wIAAAD6/wMA/P/6/wEAAQD6/wEA/v/7/wIAAgD6////AAD7/wEAAgD7//7/AQD8/wAAAwD8//3/AwD9/wAAAgD9//z/AwD/////AgD+//z/AwAAAP7/AQD///3/AgABAP3/AAAAAP3/AgACAPz///8BAP3/AQACAP3//v8BAP7/AAABAP3//v8CAP7///8BAP7//f8CAP////8AAAAA/v8CAAAAAAAAAAAA/v8BAAAAAAD//wAA//8AAP//AAD//wAA//8AAP//",
"UklGRiQEAABXQVZFZm10IBAAAAABAAIAgLsAAADuAgAEABAAZGF0YQAEAAAAAP//AAD//wAA//8AAAAA/////wAAAQD+////AAAGAP3/OAABAIIAAwBv//f/E/0QAK0ADQCzA/7/8P4u/0cBDQCJA6ABbQDg/w7/z/9o+Vn/SPnL/1//Ef+2+jr9RfZgA5QFZwILDFj+PAb2/nEFKgKk/R0Dlv6b/FUDsP6YAoj9SgAT/iL/tAPwAv8A0P6zAr7/dwAnAf39uP22/skA2v///2YCoP4UAUsAZgF2AJH+4P70/rz9+f+U/Xv/8v7CAcb+TACS/kwAv/+x/tX9oP71/oL/1f8nAEUAZwGtAAgAIgC/AD4BaP8GAGH/dQDF/64Arf8nAakAhAH9/+kAQQD3AFb/q/8p/yIAR/8FAPD/ZAA/AIYA3v8tADQADQBp/3f/CwABAP3/Wf8OANj/WwDH/xoAe/8DAKz/zv96/z8A3f/J/5X/IAD5//j/q//c/+//RADq//D/vv8pADUAFQDI/y8ACAAbANb/OwD3/+3/9f/e/wcAIAAeAMH/8/8xAC0AEADW/+3/HAADAPv/8P8DAOL/OwD3/xcACQAHAM//5f8XAAcAz//T/9D/HgD9////yf/e//v/AgD//9H/6/////H/+/8hAAIA9//7/w0AFgAQAPL/2v/8/xsAGQABANz/9P8YAAQA/v/y/wMA5v8YAAkAAAAAAAMA7/8KABgADwDs//j/BwATABsA8P/1//z/BAAMAAAA9P/s/xAA/v8GAAkA/v/p/wMACwALAP7/9P/p/wcADQAFAPb/7//4/w0ACAD8//b//v/1/wMACwD1//T/8P/8/wAACQDz/+f/5P8GAAkABQD5//D/+v8FAA0AAwD///T/AgACABAA/v8CAPD/+/8FAAoA9f/3//f//v8GAP7/9v/t//z/+f8AAPj/+v/3/wEA+v8HAPr//P/5/wQA//8DAPr/+P/3/wYA///+//X/+//5/wQA/f/7//X/+//4/wMA/f/8//j//v/9/wYA///8//f/AgAAAAUA/f/6//n/AwACAAIA/f/7//z/AwACAAAA/f/6//3/AgADAP7//f/7/wAAAwAFAPz////8/wMAAgAEAPv//v/+/wMAAgADAPv//v///wMAAQABAPv//f8AAAIAAAD///v//f8BAAIA///+//z//v8CAAIA/v/9//3///8CAAEA/v/9//7/AAACAAAA/v/9////AAABAAAA/f/9/wAAAQABAP///f/+/wEAAQAAAP///v/+/wEAAQD///7//v///wEAAQD///7//v///wEAAAD+//7///8AAAAAAAD+//7///8AAAAA///+//7///8AAAAA////////AAAAAP////////////8AAP//////////",
"UklGRiQEAABXQVZFZm10IBAAAAABAAIAgLsAAADuAgAEABAAZGF0YQAEAAAAAAAAAAABAAAAAAD//////////////v////3/////////+//8////AQD9//z/9f8BAAIA+f8dACgAWQBxAJX/qv+Y/uz9aP9k/7UDUQQBAiQA4Pgi/AkB0gKaBsD/+fxp/vz9CQSp/I/+ywDO+vMD0fzK/PABcgBeBfoBv/+uAuH9Sf5gAy39awMmBWUBuP9fA9/9fgDj/2/+EACaACcCSv9Z/2j/rv7hAA0AWf55/7L84P7E/SIAT/67AMv/tf+FAA7/1v+7/gv/IP+E/sQA+P5aAXz/tP9XAFX/tP8o/4r/j//e/yQAMv9mAJT/rgCr/9X/EwCb//H/9f7F/6D/EAAoAK3//v+e/zsAh/+B/7r/if/C/2r/4P/z/6//HwCy/0IA7/9ZALT/y/80ACgA9v/J/9//DgA5ADUALQARADIACwAfAOf/NgArACMACQBBAEcAGAAjAC4AWQBUAHcAAAAfACEAIAAcAPj/CADk/yQA7v89AEEAFwD5/xYA6f8aAOX/AADF/zQADwAUAOT/BQDr/yUA6P8XAOf/HADR/0AA8P8nAAgACQDt/ycAKAAHAPH/IQDz/xsACADn//n/DgADAA4A8P///8z/GgDN/yMA/f8QANj/MwACAC0ACwAOAO3/JgAZAAUACgAAAA4AIgAaAAkADwACAAAAHQATAAUABQACAAgACwAjAO////8AAA8ABQAPAPL//f8GAAsABgAGAPD/8v8GAPz/CAD6//H/6v8PAAgABgD4//3/9v8aAAgABwD1//7//v8QAAoACAD//wUA9v8QAAoABAAFAAgAAgAJAAoAAwD//w0AAgD//wcA/v8DAAoABQAFABUABAAKAAYABwAHAA8ACgAGAAwADwAMAAkAEAAJAAgADwAMAAgADgAJAAUACQAPAAUACwAHAAEABgAIAAEABAAGAP//AgAJAAAAAgAEAP7///8IAAIA//8GAAEAAQAJAAIA/v8EAAMA//8JAAEA/v8DAAMA/v8HAAMA/f8BAAUA/v8FAAMA/v8BAAcA//8DAAMA/v8BAAYA//8CAAMA/////wcAAAAAAAMAAAD//wYAAQD+/wMAAQD//wUAAQD+/wIAAgD//wQAAgD+/wEAAwD//wMAAwD+/wEAAwD//wIAAwD//wEABAAAAAEABAD//wAABAABAAAAAwAAAAAABAABAP//AwABAAAAAwACAP//AgACAAAAAwACAP//AgACAAAAAgACAAAAAQADAAAAAQACAAAAAQADAAAAAQACAAAAAAACAAEAAAACAAEAAAACAAEAAAABAAEAAAABAAEAAAABAAEAAAABAAEAAAABAAEAAAABAAEAAAAAAAAAAAAAAAAA",
"UklGRiQEAABXQVZFZm10IBAAAAABAAIAgLsAAADuAgAEABAAZGF0YQAEAAAAAP//AAD//wAA//8AAAAA//8AAP//AAACAAAA+f8BAAYA///4/wIA//8AAA8A/v/V/wEAEwA9AAEBRwA2AF7/kfog/3gBwv99CDYBU/qtAUX/AP7OAfkAX/o9B38FSfwaAuT14/60BAr8CQAI/tfyIQTzAXP+egdUBBwBof7TBMT8bAWi/5EEWwBRAAAKyfxE/8b88vp6ACP+PAF4/qD8MQNM/ygCJ/2XAPD9kP5gAVT/iP9I/lEB4P8qAD0BFAGa/+7/DgB2AOP98gFm/u/+Vv5/AG8ASP9gAM//qv9w//oAcv+2/jIBHgA7/6D/oAAGAKH/lADT/wAAggC8AAYAkP9yAEcAkf8BAOD/RAAr/zUANwDt/xQAJQAkAMT/zwA/AOH/xv9zAGsANQBTAIcALAAvACIATACy/xMADADg/xcAWABvAJL/7f9VAPb/EgDt/wcA4f8kAPP/5P+h/wgACQDy//r/LgAQAMn/8/9CAOX/5v/S/9//3P8pABYAuP/s/w8AFgDt/+3/7v/w/9j/5/8GAOf/2P/2//P//v8kABMAuf/m/xoADADZ/+r/3P8KAAUAKwDe/wsA3P8VAAAADgAfAB0ACAAMAF4AGgAhAPL/MwDz/0kABAAKAPX/LwAbAAkA9v/s/+3/8/8CABAAAADm//n/BQALAAUAAQDj//n/JQAVAPX/9v/+/wIAEQABAPP/8P/1/wAABgD6/+3/7//o//j/DAD8/+b/8P8IAAkABgD4//D/8P8UAAoAAwD4/wAA+f8OAAcAAAAFAPX/9v8TAAkA8v8EAPb/9/8dAA0A7/8CAPn/+f8SAAQA8/8CAOf/+v8DAAgA9P////H//P8IAAUA8//0/wIAAQAGAAgA9//7/wAA+/8EAP//+P/+////AgACAAsA8v/+/wIABQD7/wgA9v/7/wMABAD5/wAA/P/3/wEAAQD7//7//P/1/wQA///3//r////3/wMAAwD1//r/AwD6////AgD4//n/AwD8//7/AgD4//n/AwD+//3/AQD4//n/BQD///n/AAD6//j/BAABAPj/AAD9//v/AwADAPj//v/+//z/AwAEAPj//v8BAP7/AQADAPj//f8CAP////8EAPr//P8DAAAA/v8CAPv//P8DAAEA/f8BAP3//f8DAAIA/P8AAP7//f8DAAIA/P///wAA/f8BAAIA+//+/wEA//8AAAEA+//+/wEA/////wEA/P/+/wEA///+/wAA/f/9/wEAAAD9/wAA/f/+/wEAAQD8/////v/+/wAAAQD8////////////AQD9////AAD/////AAD+////AAAAAP//AAD///////8AAP//AAD//wAA//8AAP//",
];

const OmnitoneSOAHrirBase64 = [
"UklGRiQEAABXQVZFZm10IBAAAAABAAIAgLsAAADuAgAEABAAZGF0YQAEAAD+/wQA8/8ZAPr/DAD+/wMA/v8KAAQA/f8DAAMABADs//z/8v/z/8f/R/90/ob+//zAAWsDAwY3DKn9//tu93DvkwI6An4CuwJ0/BH7VPux92X0Gu7N/EX9mgfqCkkIiRMgBd4NQQGL/c0G/xBxAKELZATUA/sIHRSx+fkCyAUmBNEJIARlAdHz2AjNACcIsAW4AlECsvtJ/P/7K/tf++n8aP4W+g0FXAElAMn8nQHn/sT+Zv7N+9X2xvzM/O3+EvpqBBD7SQLd+vb/sPlw/JD72/3n+Rr+L/wS/vz6UQGg/Nf+Av5L/5X9Gv2//SP+mf3j/lf+v/2B/ZH/5P05/iL9MP9F/uf9UP4v/qv9mv7o/Xn+wP2k/8L+uP5J/tD+Dv/Y/bL+mP72/n3+pP+7/hAA+/5zAGH+Z/+u/g8Azv2y/6L+//9o/iIADP8VACz/CwCN/pb/1v4yAFP+wf+4/jsAcf5VAP3+bADa/nMA6f4sAOT+IQBd/v7/7v6aAIL+QADe/nEA0P4yAKz+CQCo/moAuf5xAN7+mAC8/jcANf9eAPX+IAA1/1kAAP9hAMz+PQD5/m0A2/4gAPr+UQDh/jQAEv9BAPH+FABN/zkASv9DADP/BABe/1IAGf8oAE3/RQAw/zIAQf8mADn/GgBE/xIAR/8hAD7/BABy/zEAKP/0/07/GwBX/z4ARf8mAFr/QQBV/zUAVP8eAFz/JABt/0EAUP8MAHz/KgBr/ycAYv8EAH3/MABl/x8Agv8bAIj/GgBv//z/ff8AAJX/IABu/+T/jv/r/4z/9/9n/77/pP8JAJD/EQCJ//r/q/8WAJ//GQCU/xYAtv8qAKr/PQCW/ysAwf8+ALb/OgC3/ygAz/8uAM7/OgDH/ygAz/8kAMz/OgC//xsA1f8qAMn/LwDN/xcA1f8oAMv/JQDR/xMAzf8bAM//HgDU/wUA2v8ZANL/EwDW/wEA1f8ZAMz/BwDX/wIA0v8SANT/BQDW/wMA0/8PANT/AADY/wIA1f8MANX/+f/a/wUA0v8IANf/+//Y/wUA0/8DANr/+f/Y/wQA1v8BANr/+f/Z/wUA1//8/9z/+v/Y/wYA2f/8/93//v/Y/wUA2v/9/93////Z/wUA3P/8/97/AgDa/wMA3v/8/97/AwDb/wIA3//9/97/BADd/wEA4f///9//BQDf/wAA4v8AAN//BQDf/wAA4/8CAN//BADh/wAA4/8DAOD/BADi////4/8DAOH/AwDk/wAA5P8FAOL/AgDl/wEA5P8FAOL/AQDl/wEA4/8EAOL/AQDj/wIA4P8DAN//AADg/wIA3v8CAOD/AADh/wEA4v8AAOP/AADm/wAA6P8AAOz/AADu/wAA",
"UklGRiQEAABXQVZFZm10IBAAAAABAAIAgLsAAADuAgAEABAAZGF0YQAEAAD//////f/+//7///8AAP////8BAAEA/f8AAAEAAQAFAAUA9//6/x0A2f/9/xMA3P+jAE//of9HAKP//gCj/77/Z/vi/28D9/ywDJAJIvr6AsX0Xec4BhcGzf23DZP7yfZ6C1//nwBDBIHyYgob/Tf3sQ41ANoKRA/A+E7yffAa9gD5EQUBDMwMygiqAHMAqPqhAGUB2/gE+a78H/+4APT6DwIUAA0HNwMhBfL8E/90A5n7dP9cALIC+v5C/q0AOv9kAogBHv01/+3/qAQD/ub8T/4vAOUA5P6KATv+ywEYAeT+KP6i/3gCFP6h/hr/+P83ACL/VADn/8UARQJI/4MAu/8qAlj+wf4iAPb/LgFJ/8QAUABAAI4ABf+k/3X/YgFK/ij/j/9HADoAi/+WAA0BVwC/ACL/LACe//cARv9i/xgAUgA0ACj/FgBgAIj/5P9M/7z/zv8/AKz/gv8sAEQA6/+I/yYAawDL/7T/xf8qAOv/FQCu/5n/EgAyAO3/i/9LAE4A+//R//P/FgDe/8z/u/8DADIALAAZALL/TAA8ABwAo//1/xwA/P/L/z0A6P8jAN7/7v+a/zAAwf/7/3//KQAuACwA9v8RAGYAIwBNADgAKgASAF0ADgANACEAMQDH//H/LQACAB0Ay////x0APAABAAQA2v8iAAcAEgDE/+v/FQD+/+P/DAD1/97/6v/4//X/EwD4/+7/5P8cAA0ACQDH//7/CQAXAAEA/P/5//j/CwAWAAEABQD9//n/AQAWAB0A7v/k/wAACQAmAP//9/8AAPn/8/8aAO//6/8fAOv/5v8hAP//5/8PAOf/AAAGAPn/6v8JAAYABgABAOv/1//1//L/+P8DABcA6f/8/wMACgD7/xAA3v/2//z/DADu//z/5v/5/wEA/P/6//7/7v/x/wQABgD5/wAA8v/w/wkAEQD2//j/+v8EAAcAEAD3//v/+v8CAAAACQD3//v//v/9/wUADAD2//X/AgAHAAAABwD2//T/BgAKAP7/AQD4//r/BAAIAPn/AAD3//f/BQAHAPv//v/7//n/BQAJAPj/+v/9//7/AgAGAPj/+f8BAAEAAgAFAPn/+v8BAAIAAAAEAPn/+f8CAAQA/v8BAPr/+v8CAAQA/P////v//P8CAAQA+//+//3//f8CAAUA+v/9//////8AAAQA+v/8////AAD//wIA+//8/wAAAQD+/wEA+//8/wAAAgD9/////P/9/wEAAgD8//7//f/9/wAAAgD8//3//v/+////AQD8//z/////////AAD8//3///8AAP7/AAD9//7///8AAP7////+//////8AAP7////+////////////////////",
"UklGRiQEAABXQVZFZm10IBAAAAABAAIAgLsAAADuAgAEABAAZGF0YQAEAAD//////v8AAP///////wAAAAAAAP7/AQABAAAABwD///X/BQAjAPL/CQDb/9D/GAAb/7sAYwCW/z0BcP/X/7T/2QDW+wH8yANCCCUJ5QT++UXmhPwhA78FuAxH+p78ifudBlAG9vmu/lAK2fdlB///cfjoCa0E7Akn9Yb/zvba+AkAHPywBGEBFwUNAL8AXAAGA20DFvmR/kz+F/06Ag/+GwHl/5EEKgJd/q0AP/ym/9n6EfxY/2H+/QFtAC4C6QBDAaMCo/20/+3/3f/p/fL9rv9V/6cBhQHuAX4AcwJYAaH/IP/P/gsApP0LAe7/sQBuAI0AAgGDAE4BzACe/5X//v+v/+f+Zf+gAOv/5QBhAOIApAANASYAuP+h/8b/HQBr/9//bACWAGEAFAB5AD0AWQDU/+D/Yf/p//D/s/+R/4QAMQBvABEAkQBfABQAJgDW/wwA8/8XALz/vf8zAFAAKwD1/zEAPwDJ/x0A7/8LAOX/FwDR//H/EQAdAO//6P8QAFEA2f8WABEAMgDy/xIA+f/s/xAALgDv////HQAvAPT/+f8iAAYAEgAFABoAGgD//w0A+f/0/xsAHgDx/9f/GAACAPH/8f8JAPf/GwALABEA7/8cAPT/CgD2//j/BQD8/+3/OgAgAAYA9f8PAN7/DgD9/9r/1//3/+3/9//1//b/8//5//f/AgAJAOf/+v8OAAMACwD9/+7/5f8eAAEA9//q//7/8P8WAP7/+//4/wIA+f8TAAIA9f/5/wcA+P8iAAgA9v/n/xoA//8gAAUABwDj/wAA9v8BAAUAFQDn/wMA7v8QABAAEQDm/wwA8f8aAAAABwDu/wcACgASAAEA7//w//f/BgARAAkA6P/3/wcADgAKAAYA4f/4/wYADgAAAPr/8P/9/xQACgAHAPn/7//9/xEAAgD+//L/8v/8/xUAAwDw//H/9f8CAAsA/v/q//L/+f8FAAYA/P/r//j///8GAAkA+//o//j/AQAIAP//+v/o//v/CAAIAPv/+P/w/wEACQAHAPj/+f/0/wIACwAFAPb/+f/4/wQACwACAPP/+f/+/wYACAD///L/+/8BAAYABQD9//P//P8FAAUAAgD7//T//f8HAAQA///7//f///8IAAMA/P/6//r/AQAIAAEA+v/6//3/AgAHAAAA+f/7/wAAAwAFAP7/+P/8/wIAAgACAP3/+f/9/wMAAwAAAPz/+v/+/wQAAgD+//z/+/8AAAQAAQD8//z//f8BAAQAAAD7//3///8BAAMA///7//3/AAACAAEA/v/7//7/AQABAAAA/v/9////AQAAAP///v/+////AAD/////////////////////////////",
"UklGRiQEAABXQVZFZm10IBAAAAABAAIAgLsAAADuAgAEABAAZGF0YQAEAAD////////+//////8AAAAA/v/+/wAAAQD8//3/CQAJAP3/+v8PAAcApABlABkBkwCO/i//lfqa/HQAcf/3BdkCzwJcBCMC0wMN/9/9wgI7AaECYfxV/Tf83vhn/xrt8Owx/8n7cgHABYb43QcZDh4WugNrA7P74gHu/9z/zv0t/acCiQHY/iv4qQOl/ysCE/0//XT9Sf4O//j9xfupAn394gHO+rsCXAFIAxQC9wIXBgcD2AQuAnb/9gJh/6wAVfxEAI4Bvf7oAFv/bALsAMQBe/88/joAT/4dAH39/v9LAXn/gwDI//QBdABcAA0A7f4lAMn///+9/tv/iABp/13/pP/dALv/w/8MAHv//f+y/6////7U/5AAZP+Z/8r/nQDR/5r/DwDr/xAA4v+s/3z/+P9uAOv/t/82AGcAHgCb/yQAFQBGAM7/CgD3/xoAegAaAOz/CgBHAA8Adv8/AAAABQC2/xIAAAA7ABQAKgCj/z4AAQAXAJz/JAADAAcA8f/1/2AAAQAlAPD/NgDx/1wA7v/4/wMAZADv//3/HQAkAFoA8P9FAPv/FgBIAPf/WQAHAEUACQD0/xIAQwDu/wMAwP9VALn/XwCw/yEA5f8sAPj/FgDD/1YAyv8rAOX/HQDo//j/IQAQACAAHwD9/yQAHQBAABgABQAiAAUAKAD3/wkACwAKAAMABwAJAPb/+f8GAOr/JQAHABMA6P8TAA4AGgD//woA8/8ZAP//GADu/w0A9v8SAAMABwD4/wQA5P8XAAQACgDq/wUA+/8VAAcACADs/xIAAAATAPH/+v/1//T/7f///+z/+v/y/+//9/8KAAcACgAJAPT/BAAKAAAABgAIAPL/9v8KAAMABAACAPr/9v8OAAIA+P/x//v/+f8MAPb/+P/w/wQA9f8MAPn////7/woA/v8PAAEAAgD1/xAAAQAPAP//AwD//xQABwALAAAABgADABAAAgAHAAAACAABAA8ABQAFAAMABwAEAA4ABwADAAEACQAFAAoAAwD//wAACQADAAUAAQD/////CAABAAMAAAD/////BwACAAEAAAD/////BwACAP7///8BAAAABgABAP7///8CAAAABAAAAP7///8DAAAAAwAAAP3///8DAAAAAQAAAP3//v8EAAAAAAD+//////8EAP/////+/wAA/v8EAP/////+/wEA/v8EAP///v/+/wIA//8DAP///v/+/wIA//8BAP///v/+/wMA//8BAP/////+/wMA//8AAP//AAD+/wQA//8AAP7/AQD//wIA////////AQD//wIA////////AQAAAAEAAAAAAP//AQD//wEAAAAAAP//AQAAAAEAAAAAAAAA",
"UklGRiQEAABXQVZFZm10IBAAAAABAAIAgLsAAADuAgAEABAAZGF0YQAEAAD+/wAA+v8AAPz/AAD//wAA/f8AAAEAAAD+/wAACQAAAAQAAAAZAAAAtgAAAFsBAABW/gAAH/oAAGcBAABoBwAAlAAAAO3/AAARAQAA+wIAAEoEAACe/gAAiv4AALD0AADJ8wAAkQQAAF34AABi8QAAPQAAAAH2AAD19AAADAMAAJwGAACTEAAA0AwAAJkHAACOBwAAuQEAANcDAAC6AgAAHwUAAHEFAAB0AwAAbgEAADz+AADYAQAAGAAAAJwCAADgAAAA//0AAMn+AAAT/AAAwP8AAOn9AAAJAAAAewEAAOn+AACN/wAAOv0AAO3+AADN/gAAcP8AACj/AACq/gAA+f4AAML9AACa/wAA/f4AAN7/AABo/wAA6/4AAE//AAAC/wAAEQAAAHX/AAB0AAAA5f8AAEwAAAB3AAAA5/8AAMIAAABCAAAAzgAAAE8AAAB3AAAAKAAAADMAAACqAAAALwAAAK4AAAASAAAAVgAAACgAAAAtAAAATAAAAP3/AAA7AAAA2/8AACQAAADw/wAALQAAADEAAAAlAAAAbAAAADMAAABUAAAAEAAAACgAAAD1/wAA9v8AAPr/AADu/wAALgAAABIAAABUAAAARAAAAGUAAABGAAAAOAAAAGAAAAAuAAAARQAAACEAAAAfAAAAAAAAAAkAAAAQAAAAAwAAABIAAADs/wAAEAAAAAYAAAASAAAAIgAAABEAAAADAAAABAAAAA8AAAD4/wAAHQAAAAsAAAAIAAAADgAAAP//AAAcAAAADwAAAAYAAAASAAAAFwAAAAMAAAAYAAAAEgAAAPr/AAAQAAAADQAAAAoAAAD3/wAABgAAAPb/AADf/wAA/v8AAPL/AAD6/wAAFAAAAAQAAAAEAAAAGwAAAAEAAAAMAAAAIAAAAAIAAAAdAAAAGAAAAAIAAAAcAAAAEgAAAAcAAAAeAAAADwAAAAQAAAAeAAAABAAAAAYAAAAZAAAAAQAAAA4AAAATAAAA/v8AAAoAAAAOAAAA+/8AAAsAAAAJAAAA+f8AAAsAAAABAAAA+f8AAAoAAAD9/wAA+v8AAAcAAAD5/wAA+v8AAAUAAAD3/wAA/f8AAAQAAAD2/wAAAAAAAAEAAAD3/wAAAgAAAAAAAAD4/wAAAwAAAP7/AAD6/wAABAAAAP3/AAD8/wAABAAAAPv/AAD+/wAAAwAAAPv/AAD//wAAAQAAAPv/AAAAAAAAAAAAAPv/AAACAAAA//8AAPz/AAACAAAA/v8AAP3/AAACAAAA/f8AAP7/AAABAAAA/f8AAP//AAABAAAA/f8AAAAAAAAAAAAA/v8AAAEAAAAAAAAA//8AAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
];

/**
 * @license
 * Copyright 2017 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */


// Currently SOA and TOA are only supported.
const SupportedAmbisonicOrder = [2, 3];


/**
 * Omnitone HOA renderer class. Uses the optimized convolution technique.
 */
class HOARenderer {
    /**
     * Omnitone HOA renderer class. Uses the optimized convolution technique.
     * @param {AudioContext} context - Associated AudioContext.
     * @param {Object} config
     * @param {Number} [config.ambisonicOrder=3] - Ambisonic order.
     * @param {Array} [config.hrirPathList] - A list of paths to HRIR files. It
     * overrides the internal HRIR list if given.
     * @param {RenderingMode} [config.renderingMode='ambisonic'] - Rendering mode.
     */
    constructor(context, config) {
        if (!isAudioContext(context)) {
            throwError('HOARenderer: Invalid BaseAudioContext.');
        }

        this._context = context;

        this._config = {
            ambisonicOrder: 3,
            renderingMode: RenderingMode.AMBISONIC,
        };

        if (config && config.ambisonicOrder) {
            if (SupportedAmbisonicOrder.includes(config.ambisonicOrder)) {
                this._config.ambisonicOrder = config.ambisonicOrder;
            } else {
                log(
                    'HOARenderer: Invalid ambisonic order. (got ' +
                    config.ambisonicOrder + ') Fallbacks to 3rd-order ambisonic.');
            }
        }

        this._config.numberOfChannels =
            (this._config.ambisonicOrder + 1) * (this._config.ambisonicOrder + 1);
        this._config.numberOfStereoChannels =
            Math.ceil(this._config.numberOfChannels / 2);

        if (config && config.hrirPathList) {
            if (Array.isArray(config.hrirPathList) &&
                config.hrirPathList.length === this._config.numberOfStereoChannels) {
                this._config.pathList = config.hrirPathList;
            } else {
                throwError(
                    'HOARenderer: Invalid HRIR URLs. It must be an array with ' +
                    this._config.numberOfStereoChannels + ' URLs to HRIR files.' +
                    ' (got ' + config.hrirPathList + ')');
            }
        }

        if (config && config.renderingMode) {
            if (Object.values(RenderingMode).includes(config.renderingMode)) {
                this._config.renderingMode = config.renderingMode;
            } else {
                log(
                    'HOARenderer: Invalid rendering mode. (got ' +
                    config.renderingMode + ') Fallbacks to "ambisonic".');
            }
        }

        this._buildAudioGraph();
    }


    /**
     * Builds the internal audio graph.
     * @private
     */
    _buildAudioGraph() {
        this.input = this._context.createGain();
        this.output = this._context.createGain();
        this._bypass = this._context.createGain();
        this._hoaRotator = new HOARotator(this._context, this._config.ambisonicOrder);
        this._hoaConvolver =
            new HOAConvolver(this._context, this._config.ambisonicOrder);
        this.input.connect(this._hoaRotator.input);
        this.input.connect(this._bypass);
        this._hoaRotator.output.connect(this._hoaConvolver.input);
        this._hoaConvolver.output.connect(this.output);

        this.input.channelCount = this._config.numberOfChannels;
        this.input.channelCountMode = 'explicit';
        this.input.channelInterpretation = 'discrete';
    }

    dispose() {
        if (this.getRenderingMode() === RenderingMode.BYPASS) {
            this._bypass.connect(this.output);
        }

        this.input.disconnect(this._hoaRotator.input);
        this.input.disconnect(this._bypass);
        this._hoaRotator.output.disconnect(this._hoaConvolver.input);
        this._hoaConvolver.output.disconnect(this.output);

        this._hoaRotator.dispose();
        this._hoaConvolver.dispose();
    }

    /**
     * Initializes and loads the resource for the renderer.
     * @return {Promise}
     */
    async initialize() {
        log(
            'HOARenderer: Initializing... (mode: ' + this._config.renderingMode +
            ', ambisonic order: ' + this._config.ambisonicOrder + ')');


        let bufferList;
        if (this._config.pathList) {
            bufferList =
                new BufferList(this._context, this._config.pathList, { dataType: 'url' });
        } else {
            bufferList = this._config.ambisonicOrder === 2
                ? new BufferList(this._context, OmnitoneSOAHrirBase64)
                : new BufferList(this._context, OmnitoneTOAHrirBase64);
        }

        try {
            const hrirBufferList = await bufferList.load();
            this._hoaConvolver.setHRIRBufferList(hrirBufferList);
            this.setRenderingMode(this._config.renderingMode);
            log('HOARenderer: HRIRs loaded successfully. Ready.');
        }
        catch (exp) {
            const errorMessage = 'HOARenderer: HRIR loading/decoding failed. Reason: ' + exp.message;
            throwError(errorMessage);
        }
    }


    /**
     * Updates the rotation matrix with 3x3 matrix.
     * @param {Number[]} rotationMatrix3 - A 3x3 rotation matrix. (column-major)
     */
    setRotationMatrix3(rotationMatrix3) {
        this._hoaRotator.setRotationMatrix3(rotationMatrix3);
    }


    /**
     * Updates the rotation matrix with 4x4 matrix.
     * @param {Number[]} rotationMatrix4 - A 4x4 rotation matrix. (column-major)
     */
    setRotationMatrix4(rotationMatrix4) {
        this._hoaRotator.setRotationMatrix4(rotationMatrix4);
    }

    getRenderingMode() {
        return this._config.renderingMode;
    }

    /**
     * Set the decoding mode.
     * @param {RenderingMode} mode - Decoding mode.
     *  - 'ambisonic': activates the ambisonic decoding/binaurl rendering.
     *  - 'bypass': bypasses the input stream directly to the output. No ambisonic
     *    decoding or encoding.
     *  - 'off': all the processing off saving the CPU power.
     */
    setRenderingMode(mode) {
        if (mode === this._config.renderingMode) {
            return;
        }

        switch (mode) {
            case RenderingMode.AMBISONIC:
                this._hoaConvolver.enable();
                this._bypass.disconnect();
                break;
            case RenderingMode.BYPASS:
                this._hoaConvolver.disable();
                this._bypass.connect(this.output);
                break;
            case RenderingMode.OFF:
                this._hoaConvolver.disable();
                this._bypass.disconnect();
                break;
            default:
                log(
                    'HOARenderer: Rendering mode "' + mode + '" is not ' +
                    'supported.');
                return;
        }

        this._config.renderingMode = mode;
        log('HOARenderer: Rendering mode changed. (' + mode + ')');
    }
}

/**
 * @license
 * Copyright 2017 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @file Cross-browser support polyfill for Omnitone library.
 */

/**
 * Detects browser type and version.
 * @return {string[]} - An array contains the detected browser name and version.
 */
function getBrowserInfo() {
    const ua = navigator.userAgent;
    let M = ua.match(
        /(opera|chrome|safari|firefox|msie|trident(?=\/))\/?\s*([\d\.]+)/i) ||
        [];
    let tem;

    if (/trident/i.test(M[1])) {
        tem = /\brv[ :]+(\d+)/g.exec(ua) || [];
        return { name: 'IE', version: (tem[1] || '') };
    }

    if (M[1] === 'Chrome') {
        tem = ua.match(/\bOPR|Edge\/(\d+)/);
        if (tem != null) {
            return { name: 'Opera', version: tem[1] };
        }
    }

    M = M[2] ? [M[1], M[2]] : [navigator.appName, navigator.appVersion, '-?'];
    if ((tem = ua.match(/version\/([\d.]+)/i)) != null) {
        M.splice(1, 1, tem[1]);
    }

    let platform = ua.match(/android|ipad|iphone/i);
    if (!platform) {
        platform = ua.match(/cros|linux|mac os x|windows/i);
    }

    return {
        name: M[0],
        version: M[1],
        platform: platform ? platform[0] : 'unknown',
    };
}


/**
 * Patches AudioContext if the prefixed API is found.
 */
function patchSafari() {
    if (window.webkitAudioContext && window.webkitOfflineAudioContext) {
        window.AudioContext = window.webkitAudioContext;
        window.OfflineAudioContext = window.webkitOfflineAudioContext;
    }
}

/**
 * @license
 * Copyright 2016 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @file Omnitone version.
 */


/**
 * Omnitone library version
 * @type {String}
 */
const Version = '1.4.2';

/**
 * @license
 * Copyright 2016 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */


/**
 * @typedef {Object} BrowserInfo
 * @property {string} name - Browser name.
 * @property {string} version - Browser version.
 */

/**
 * An object contains the detected browser name and version.
 * @memberOf Omnitone
 * @static {BrowserInfo}
 */
const browserInfo = getBrowserInfo();


/**
 * Create a FOARenderer, the first-order ambisonic decoder and the optimized
 * binaural renderer.
 * @param {AudioContext} context - Associated AudioContext.
 * @param {Object} config
 * @param {Array} [config.channelMap] - Custom channel routing map. Useful for
 * handling the inconsistency in browser's multichannel audio decoding.
 * @param {Array} [config.hrirPathList] - A list of paths to HRIR files. It
 * overrides the internal HRIR list if given.
 * @param {RenderingMode} [config.renderingMode='ambisonic'] - Rendering mode.
 * @return {FOARenderer}
 */
function createFOARenderer(context, config) {
  return new FOARenderer(context, config);
}

/**
 * Creates HOARenderer for higher-order ambisonic decoding and the optimized
 * binaural rendering.
 * @param {AudioContext} context - Associated AudioContext.
 * @param {Object} config
 * @param {Number} [config.ambisonicOrder=3] - Ambisonic order.
 * @param {Array} [config.hrirPathList] - A list of paths to HRIR files. It
 * overrides the internal HRIR list if given.
 * @param {RenderingMode} [config.renderingMode='ambisonic'] - Rendering mode.
 * @return {HOARenderer}
 */
function createHOARenderer(context, config) {
  return new HOARenderer(context, config);
}

// Handle Pre-load Tasks: detects the browser information and prints out the
// version number. If the browser is Safari, patch prefixed interfaces.
(function() {
  log(`Version ${Version} (running ${browserInfo.name} \
${browserInfo.version} on ${browserInfo.platform})`);
  if (browserInfo.name.toLowerCase() === 'safari') {
    patchSafari();
    log(`${browserInfo.name} detected. Polyfill applied.`);
  }
})();

/**
 * Copyright 2017 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @file Pre-computed lookup tables for encoding ambisonic sources.
 * @author Andrew Allen <bitllama@google.com>
 */



/**
 * Pre-computed Spherical Harmonics Coefficients.
 *
 * This function generates an efficient lookup table of SH coefficients. It
 * exploits the way SHs are generated (i.e. Ylm = Nlm * Plm * Em). Since Nlm
 * & Plm coefficients only depend on theta, and Em only depends on phi, we
 * can separate the equation along these lines. Em does not depend on
 * degree, so we only need to compute (2 * l) per azimuth Em total and
 * Nlm * Plm is symmetrical across indexes, so only positive indexes are
 * computed ((l + 1) * (l + 2) / 2 - 1) per elevation.
 * @type {Float32Array}
 */
const SPHERICAL_HARMONICS =
[
  [
    [0.000000, 0.000000, 0.000000, 1.000000, 1.000000, 1.000000],
    [0.052336, 0.034899, 0.017452, 0.999848, 0.999391, 0.998630],
    [0.104528, 0.069756, 0.034899, 0.999391, 0.997564, 0.994522],
    [0.156434, 0.104528, 0.052336, 0.998630, 0.994522, 0.987688],
    [0.207912, 0.139173, 0.069756, 0.997564, 0.990268, 0.978148],
    [0.258819, 0.173648, 0.087156, 0.996195, 0.984808, 0.965926],
    [0.309017, 0.207912, 0.104528, 0.994522, 0.978148, 0.951057],
    [0.358368, 0.241922, 0.121869, 0.992546, 0.970296, 0.933580],
    [0.406737, 0.275637, 0.139173, 0.990268, 0.961262, 0.913545],
    [0.453990, 0.309017, 0.156434, 0.987688, 0.951057, 0.891007],
    [0.500000, 0.342020, 0.173648, 0.984808, 0.939693, 0.866025],
    [0.544639, 0.374607, 0.190809, 0.981627, 0.927184, 0.838671],
    [0.587785, 0.406737, 0.207912, 0.978148, 0.913545, 0.809017],
    [0.629320, 0.438371, 0.224951, 0.974370, 0.898794, 0.777146],
    [0.669131, 0.469472, 0.241922, 0.970296, 0.882948, 0.743145],
    [0.707107, 0.500000, 0.258819, 0.965926, 0.866025, 0.707107],
    [0.743145, 0.529919, 0.275637, 0.961262, 0.848048, 0.669131],
    [0.777146, 0.559193, 0.292372, 0.956305, 0.829038, 0.629320],
    [0.809017, 0.587785, 0.309017, 0.951057, 0.809017, 0.587785],
    [0.838671, 0.615661, 0.325568, 0.945519, 0.788011, 0.544639],
    [0.866025, 0.642788, 0.342020, 0.939693, 0.766044, 0.500000],
    [0.891007, 0.669131, 0.358368, 0.933580, 0.743145, 0.453990],
    [0.913545, 0.694658, 0.374607, 0.927184, 0.719340, 0.406737],
    [0.933580, 0.719340, 0.390731, 0.920505, 0.694658, 0.358368],
    [0.951057, 0.743145, 0.406737, 0.913545, 0.669131, 0.309017],
    [0.965926, 0.766044, 0.422618, 0.906308, 0.642788, 0.258819],
    [0.978148, 0.788011, 0.438371, 0.898794, 0.615661, 0.207912],
    [0.987688, 0.809017, 0.453990, 0.891007, 0.587785, 0.156434],
    [0.994522, 0.829038, 0.469472, 0.882948, 0.559193, 0.104528],
    [0.998630, 0.848048, 0.484810, 0.874620, 0.529919, 0.052336],
    [1.000000, 0.866025, 0.500000, 0.866025, 0.500000, 0.000000],
    [0.998630, 0.882948, 0.515038, 0.857167, 0.469472, -0.052336],
    [0.994522, 0.898794, 0.529919, 0.848048, 0.438371, -0.104528],
    [0.987688, 0.913545, 0.544639, 0.838671, 0.406737, -0.156434],
    [0.978148, 0.927184, 0.559193, 0.829038, 0.374607, -0.207912],
    [0.965926, 0.939693, 0.573576, 0.819152, 0.342020, -0.258819],
    [0.951057, 0.951057, 0.587785, 0.809017, 0.309017, -0.309017],
    [0.933580, 0.961262, 0.601815, 0.798636, 0.275637, -0.358368],
    [0.913545, 0.970296, 0.615661, 0.788011, 0.241922, -0.406737],
    [0.891007, 0.978148, 0.629320, 0.777146, 0.207912, -0.453990],
    [0.866025, 0.984808, 0.642788, 0.766044, 0.173648, -0.500000],
    [0.838671, 0.990268, 0.656059, 0.754710, 0.139173, -0.544639],
    [0.809017, 0.994522, 0.669131, 0.743145, 0.104528, -0.587785],
    [0.777146, 0.997564, 0.681998, 0.731354, 0.069756, -0.629320],
    [0.743145, 0.999391, 0.694658, 0.719340, 0.034899, -0.669131],
    [0.707107, 1.000000, 0.707107, 0.707107, 0.000000, -0.707107],
    [0.669131, 0.999391, 0.719340, 0.694658, -0.034899, -0.743145],
    [0.629320, 0.997564, 0.731354, 0.681998, -0.069756, -0.777146],
    [0.587785, 0.994522, 0.743145, 0.669131, -0.104528, -0.809017],
    [0.544639, 0.990268, 0.754710, 0.656059, -0.139173, -0.838671],
    [0.500000, 0.984808, 0.766044, 0.642788, -0.173648, -0.866025],
    [0.453990, 0.978148, 0.777146, 0.629320, -0.207912, -0.891007],
    [0.406737, 0.970296, 0.788011, 0.615661, -0.241922, -0.913545],
    [0.358368, 0.961262, 0.798636, 0.601815, -0.275637, -0.933580],
    [0.309017, 0.951057, 0.809017, 0.587785, -0.309017, -0.951057],
    [0.258819, 0.939693, 0.819152, 0.573576, -0.342020, -0.965926],
    [0.207912, 0.927184, 0.829038, 0.559193, -0.374607, -0.978148],
    [0.156434, 0.913545, 0.838671, 0.544639, -0.406737, -0.987688],
    [0.104528, 0.898794, 0.848048, 0.529919, -0.438371, -0.994522],
    [0.052336, 0.882948, 0.857167, 0.515038, -0.469472, -0.998630],
    [0.000000, 0.866025, 0.866025, 0.500000, -0.500000, -1.000000],
    [-0.052336, 0.848048, 0.874620, 0.484810, -0.529919, -0.998630],
    [-0.104528, 0.829038, 0.882948, 0.469472, -0.559193, -0.994522],
    [-0.156434, 0.809017, 0.891007, 0.453990, -0.587785, -0.987688],
    [-0.207912, 0.788011, 0.898794, 0.438371, -0.615661, -0.978148],
    [-0.258819, 0.766044, 0.906308, 0.422618, -0.642788, -0.965926],
    [-0.309017, 0.743145, 0.913545, 0.406737, -0.669131, -0.951057],
    [-0.358368, 0.719340, 0.920505, 0.390731, -0.694658, -0.933580],
    [-0.406737, 0.694658, 0.927184, 0.374607, -0.719340, -0.913545],
    [-0.453990, 0.669131, 0.933580, 0.358368, -0.743145, -0.891007],
    [-0.500000, 0.642788, 0.939693, 0.342020, -0.766044, -0.866025],
    [-0.544639, 0.615661, 0.945519, 0.325568, -0.788011, -0.838671],
    [-0.587785, 0.587785, 0.951057, 0.309017, -0.809017, -0.809017],
    [-0.629320, 0.559193, 0.956305, 0.292372, -0.829038, -0.777146],
    [-0.669131, 0.529919, 0.961262, 0.275637, -0.848048, -0.743145],
    [-0.707107, 0.500000, 0.965926, 0.258819, -0.866025, -0.707107],
    [-0.743145, 0.469472, 0.970296, 0.241922, -0.882948, -0.669131],
    [-0.777146, 0.438371, 0.974370, 0.224951, -0.898794, -0.629320],
    [-0.809017, 0.406737, 0.978148, 0.207912, -0.913545, -0.587785],
    [-0.838671, 0.374607, 0.981627, 0.190809, -0.927184, -0.544639],
    [-0.866025, 0.342020, 0.984808, 0.173648, -0.939693, -0.500000],
    [-0.891007, 0.309017, 0.987688, 0.156434, -0.951057, -0.453990],
    [-0.913545, 0.275637, 0.990268, 0.139173, -0.961262, -0.406737],
    [-0.933580, 0.241922, 0.992546, 0.121869, -0.970296, -0.358368],
    [-0.951057, 0.207912, 0.994522, 0.104528, -0.978148, -0.309017],
    [-0.965926, 0.173648, 0.996195, 0.087156, -0.984808, -0.258819],
    [-0.978148, 0.139173, 0.997564, 0.069756, -0.990268, -0.207912],
    [-0.987688, 0.104528, 0.998630, 0.052336, -0.994522, -0.156434],
    [-0.994522, 0.069756, 0.999391, 0.034899, -0.997564, -0.104528],
    [-0.998630, 0.034899, 0.999848, 0.017452, -0.999391, -0.052336],
    [-1.000000, 0.000000, 1.000000, 0.000000, -1.000000, -0.000000],
    [-0.998630, -0.034899, 0.999848, -0.017452, -0.999391, 0.052336],
    [-0.994522, -0.069756, 0.999391, -0.034899, -0.997564, 0.104528],
    [-0.987688, -0.104528, 0.998630, -0.052336, -0.994522, 0.156434],
    [-0.978148, -0.139173, 0.997564, -0.069756, -0.990268, 0.207912],
    [-0.965926, -0.173648, 0.996195, -0.087156, -0.984808, 0.258819],
    [-0.951057, -0.207912, 0.994522, -0.104528, -0.978148, 0.309017],
    [-0.933580, -0.241922, 0.992546, -0.121869, -0.970296, 0.358368],
    [-0.913545, -0.275637, 0.990268, -0.139173, -0.961262, 0.406737],
    [-0.891007, -0.309017, 0.987688, -0.156434, -0.951057, 0.453990],
    [-0.866025, -0.342020, 0.984808, -0.173648, -0.939693, 0.500000],
    [-0.838671, -0.374607, 0.981627, -0.190809, -0.927184, 0.544639],
    [-0.809017, -0.406737, 0.978148, -0.207912, -0.913545, 0.587785],
    [-0.777146, -0.438371, 0.974370, -0.224951, -0.898794, 0.629320],
    [-0.743145, -0.469472, 0.970296, -0.241922, -0.882948, 0.669131],
    [-0.707107, -0.500000, 0.965926, -0.258819, -0.866025, 0.707107],
    [-0.669131, -0.529919, 0.961262, -0.275637, -0.848048, 0.743145],
    [-0.629320, -0.559193, 0.956305, -0.292372, -0.829038, 0.777146],
    [-0.587785, -0.587785, 0.951057, -0.309017, -0.809017, 0.809017],
    [-0.544639, -0.615661, 0.945519, -0.325568, -0.788011, 0.838671],
    [-0.500000, -0.642788, 0.939693, -0.342020, -0.766044, 0.866025],
    [-0.453990, -0.669131, 0.933580, -0.358368, -0.743145, 0.891007],
    [-0.406737, -0.694658, 0.927184, -0.374607, -0.719340, 0.913545],
    [-0.358368, -0.719340, 0.920505, -0.390731, -0.694658, 0.933580],
    [-0.309017, -0.743145, 0.913545, -0.406737, -0.669131, 0.951057],
    [-0.258819, -0.766044, 0.906308, -0.422618, -0.642788, 0.965926],
    [-0.207912, -0.788011, 0.898794, -0.438371, -0.615661, 0.978148],
    [-0.156434, -0.809017, 0.891007, -0.453990, -0.587785, 0.987688],
    [-0.104528, -0.829038, 0.882948, -0.469472, -0.559193, 0.994522],
    [-0.052336, -0.848048, 0.874620, -0.484810, -0.529919, 0.998630],
    [-0.000000, -0.866025, 0.866025, -0.500000, -0.500000, 1.000000],
    [0.052336, -0.882948, 0.857167, -0.515038, -0.469472, 0.998630],
    [0.104528, -0.898794, 0.848048, -0.529919, -0.438371, 0.994522],
    [0.156434, -0.913545, 0.838671, -0.544639, -0.406737, 0.987688],
    [0.207912, -0.927184, 0.829038, -0.559193, -0.374607, 0.978148],
    [0.258819, -0.939693, 0.819152, -0.573576, -0.342020, 0.965926],
    [0.309017, -0.951057, 0.809017, -0.587785, -0.309017, 0.951057],
    [0.358368, -0.961262, 0.798636, -0.601815, -0.275637, 0.933580],
    [0.406737, -0.970296, 0.788011, -0.615661, -0.241922, 0.913545],
    [0.453990, -0.978148, 0.777146, -0.629320, -0.207912, 0.891007],
    [0.500000, -0.984808, 0.766044, -0.642788, -0.173648, 0.866025],
    [0.544639, -0.990268, 0.754710, -0.656059, -0.139173, 0.838671],
    [0.587785, -0.994522, 0.743145, -0.669131, -0.104528, 0.809017],
    [0.629320, -0.997564, 0.731354, -0.681998, -0.069756, 0.777146],
    [0.669131, -0.999391, 0.719340, -0.694658, -0.034899, 0.743145],
    [0.707107, -1.000000, 0.707107, -0.707107, -0.000000, 0.707107],
    [0.743145, -0.999391, 0.694658, -0.719340, 0.034899, 0.669131],
    [0.777146, -0.997564, 0.681998, -0.731354, 0.069756, 0.629320],
    [0.809017, -0.994522, 0.669131, -0.743145, 0.104528, 0.587785],
    [0.838671, -0.990268, 0.656059, -0.754710, 0.139173, 0.544639],
    [0.866025, -0.984808, 0.642788, -0.766044, 0.173648, 0.500000],
    [0.891007, -0.978148, 0.629320, -0.777146, 0.207912, 0.453990],
    [0.913545, -0.970296, 0.615661, -0.788011, 0.241922, 0.406737],
    [0.933580, -0.961262, 0.601815, -0.798636, 0.275637, 0.358368],
    [0.951057, -0.951057, 0.587785, -0.809017, 0.309017, 0.309017],
    [0.965926, -0.939693, 0.573576, -0.819152, 0.342020, 0.258819],
    [0.978148, -0.927184, 0.559193, -0.829038, 0.374607, 0.207912],
    [0.987688, -0.913545, 0.544639, -0.838671, 0.406737, 0.156434],
    [0.994522, -0.898794, 0.529919, -0.848048, 0.438371, 0.104528],
    [0.998630, -0.882948, 0.515038, -0.857167, 0.469472, 0.052336],
    [1.000000, -0.866025, 0.500000, -0.866025, 0.500000, 0.000000],
    [0.998630, -0.848048, 0.484810, -0.874620, 0.529919, -0.052336],
    [0.994522, -0.829038, 0.469472, -0.882948, 0.559193, -0.104528],
    [0.987688, -0.809017, 0.453990, -0.891007, 0.587785, -0.156434],
    [0.978148, -0.788011, 0.438371, -0.898794, 0.615661, -0.207912],
    [0.965926, -0.766044, 0.422618, -0.906308, 0.642788, -0.258819],
    [0.951057, -0.743145, 0.406737, -0.913545, 0.669131, -0.309017],
    [0.933580, -0.719340, 0.390731, -0.920505, 0.694658, -0.358368],
    [0.913545, -0.694658, 0.374607, -0.927184, 0.719340, -0.406737],
    [0.891007, -0.669131, 0.358368, -0.933580, 0.743145, -0.453990],
    [0.866025, -0.642788, 0.342020, -0.939693, 0.766044, -0.500000],
    [0.838671, -0.615661, 0.325568, -0.945519, 0.788011, -0.544639],
    [0.809017, -0.587785, 0.309017, -0.951057, 0.809017, -0.587785],
    [0.777146, -0.559193, 0.292372, -0.956305, 0.829038, -0.629320],
    [0.743145, -0.529919, 0.275637, -0.961262, 0.848048, -0.669131],
    [0.707107, -0.500000, 0.258819, -0.965926, 0.866025, -0.707107],
    [0.669131, -0.469472, 0.241922, -0.970296, 0.882948, -0.743145],
    [0.629320, -0.438371, 0.224951, -0.974370, 0.898794, -0.777146],
    [0.587785, -0.406737, 0.207912, -0.978148, 0.913545, -0.809017],
    [0.544639, -0.374607, 0.190809, -0.981627, 0.927184, -0.838671],
    [0.500000, -0.342020, 0.173648, -0.984808, 0.939693, -0.866025],
    [0.453990, -0.309017, 0.156434, -0.987688, 0.951057, -0.891007],
    [0.406737, -0.275637, 0.139173, -0.990268, 0.961262, -0.913545],
    [0.358368, -0.241922, 0.121869, -0.992546, 0.970296, -0.933580],
    [0.309017, -0.207912, 0.104528, -0.994522, 0.978148, -0.951057],
    [0.258819, -0.173648, 0.087156, -0.996195, 0.984808, -0.965926],
    [0.207912, -0.139173, 0.069756, -0.997564, 0.990268, -0.978148],
    [0.156434, -0.104528, 0.052336, -0.998630, 0.994522, -0.987688],
    [0.104528, -0.069756, 0.034899, -0.999391, 0.997564, -0.994522],
    [0.052336, -0.034899, 0.017452, -0.999848, 0.999391, -0.998630],
    [0.000000, -0.000000, 0.000000, -1.000000, 1.000000, -1.000000],
    [-0.052336, 0.034899, -0.017452, -0.999848, 0.999391, -0.998630],
    [-0.104528, 0.069756, -0.034899, -0.999391, 0.997564, -0.994522],
    [-0.156434, 0.104528, -0.052336, -0.998630, 0.994522, -0.987688],
    [-0.207912, 0.139173, -0.069756, -0.997564, 0.990268, -0.978148],
    [-0.258819, 0.173648, -0.087156, -0.996195, 0.984808, -0.965926],
    [-0.309017, 0.207912, -0.104528, -0.994522, 0.978148, -0.951057],
    [-0.358368, 0.241922, -0.121869, -0.992546, 0.970296, -0.933580],
    [-0.406737, 0.275637, -0.139173, -0.990268, 0.961262, -0.913545],
    [-0.453990, 0.309017, -0.156434, -0.987688, 0.951057, -0.891007],
    [-0.500000, 0.342020, -0.173648, -0.984808, 0.939693, -0.866025],
    [-0.544639, 0.374607, -0.190809, -0.981627, 0.927184, -0.838671],
    [-0.587785, 0.406737, -0.207912, -0.978148, 0.913545, -0.809017],
    [-0.629320, 0.438371, -0.224951, -0.974370, 0.898794, -0.777146],
    [-0.669131, 0.469472, -0.241922, -0.970296, 0.882948, -0.743145],
    [-0.707107, 0.500000, -0.258819, -0.965926, 0.866025, -0.707107],
    [-0.743145, 0.529919, -0.275637, -0.961262, 0.848048, -0.669131],
    [-0.777146, 0.559193, -0.292372, -0.956305, 0.829038, -0.629320],
    [-0.809017, 0.587785, -0.309017, -0.951057, 0.809017, -0.587785],
    [-0.838671, 0.615661, -0.325568, -0.945519, 0.788011, -0.544639],
    [-0.866025, 0.642788, -0.342020, -0.939693, 0.766044, -0.500000],
    [-0.891007, 0.669131, -0.358368, -0.933580, 0.743145, -0.453990],
    [-0.913545, 0.694658, -0.374607, -0.927184, 0.719340, -0.406737],
    [-0.933580, 0.719340, -0.390731, -0.920505, 0.694658, -0.358368],
    [-0.951057, 0.743145, -0.406737, -0.913545, 0.669131, -0.309017],
    [-0.965926, 0.766044, -0.422618, -0.906308, 0.642788, -0.258819],
    [-0.978148, 0.788011, -0.438371, -0.898794, 0.615661, -0.207912],
    [-0.987688, 0.809017, -0.453990, -0.891007, 0.587785, -0.156434],
    [-0.994522, 0.829038, -0.469472, -0.882948, 0.559193, -0.104528],
    [-0.998630, 0.848048, -0.484810, -0.874620, 0.529919, -0.052336],
    [-1.000000, 0.866025, -0.500000, -0.866025, 0.500000, 0.000000],
    [-0.998630, 0.882948, -0.515038, -0.857167, 0.469472, 0.052336],
    [-0.994522, 0.898794, -0.529919, -0.848048, 0.438371, 0.104528],
    [-0.987688, 0.913545, -0.544639, -0.838671, 0.406737, 0.156434],
    [-0.978148, 0.927184, -0.559193, -0.829038, 0.374607, 0.207912],
    [-0.965926, 0.939693, -0.573576, -0.819152, 0.342020, 0.258819],
    [-0.951057, 0.951057, -0.587785, -0.809017, 0.309017, 0.309017],
    [-0.933580, 0.961262, -0.601815, -0.798636, 0.275637, 0.358368],
    [-0.913545, 0.970296, -0.615661, -0.788011, 0.241922, 0.406737],
    [-0.891007, 0.978148, -0.629320, -0.777146, 0.207912, 0.453990],
    [-0.866025, 0.984808, -0.642788, -0.766044, 0.173648, 0.500000],
    [-0.838671, 0.990268, -0.656059, -0.754710, 0.139173, 0.544639],
    [-0.809017, 0.994522, -0.669131, -0.743145, 0.104528, 0.587785],
    [-0.777146, 0.997564, -0.681998, -0.731354, 0.069756, 0.629320],
    [-0.743145, 0.999391, -0.694658, -0.719340, 0.034899, 0.669131],
    [-0.707107, 1.000000, -0.707107, -0.707107, 0.000000, 0.707107],
    [-0.669131, 0.999391, -0.719340, -0.694658, -0.034899, 0.743145],
    [-0.629320, 0.997564, -0.731354, -0.681998, -0.069756, 0.777146],
    [-0.587785, 0.994522, -0.743145, -0.669131, -0.104528, 0.809017],
    [-0.544639, 0.990268, -0.754710, -0.656059, -0.139173, 0.838671],
    [-0.500000, 0.984808, -0.766044, -0.642788, -0.173648, 0.866025],
    [-0.453990, 0.978148, -0.777146, -0.629320, -0.207912, 0.891007],
    [-0.406737, 0.970296, -0.788011, -0.615661, -0.241922, 0.913545],
    [-0.358368, 0.961262, -0.798636, -0.601815, -0.275637, 0.933580],
    [-0.309017, 0.951057, -0.809017, -0.587785, -0.309017, 0.951057],
    [-0.258819, 0.939693, -0.819152, -0.573576, -0.342020, 0.965926],
    [-0.207912, 0.927184, -0.829038, -0.559193, -0.374607, 0.978148],
    [-0.156434, 0.913545, -0.838671, -0.544639, -0.406737, 0.987688],
    [-0.104528, 0.898794, -0.848048, -0.529919, -0.438371, 0.994522],
    [-0.052336, 0.882948, -0.857167, -0.515038, -0.469472, 0.998630],
    [-0.000000, 0.866025, -0.866025, -0.500000, -0.500000, 1.000000],
    [0.052336, 0.848048, -0.874620, -0.484810, -0.529919, 0.998630],
    [0.104528, 0.829038, -0.882948, -0.469472, -0.559193, 0.994522],
    [0.156434, 0.809017, -0.891007, -0.453990, -0.587785, 0.987688],
    [0.207912, 0.788011, -0.898794, -0.438371, -0.615661, 0.978148],
    [0.258819, 0.766044, -0.906308, -0.422618, -0.642788, 0.965926],
    [0.309017, 0.743145, -0.913545, -0.406737, -0.669131, 0.951057],
    [0.358368, 0.719340, -0.920505, -0.390731, -0.694658, 0.933580],
    [0.406737, 0.694658, -0.927184, -0.374607, -0.719340, 0.913545],
    [0.453990, 0.669131, -0.933580, -0.358368, -0.743145, 0.891007],
    [0.500000, 0.642788, -0.939693, -0.342020, -0.766044, 0.866025],
    [0.544639, 0.615661, -0.945519, -0.325568, -0.788011, 0.838671],
    [0.587785, 0.587785, -0.951057, -0.309017, -0.809017, 0.809017],
    [0.629320, 0.559193, -0.956305, -0.292372, -0.829038, 0.777146],
    [0.669131, 0.529919, -0.961262, -0.275637, -0.848048, 0.743145],
    [0.707107, 0.500000, -0.965926, -0.258819, -0.866025, 0.707107],
    [0.743145, 0.469472, -0.970296, -0.241922, -0.882948, 0.669131],
    [0.777146, 0.438371, -0.974370, -0.224951, -0.898794, 0.629320],
    [0.809017, 0.406737, -0.978148, -0.207912, -0.913545, 0.587785],
    [0.838671, 0.374607, -0.981627, -0.190809, -0.927184, 0.544639],
    [0.866025, 0.342020, -0.984808, -0.173648, -0.939693, 0.500000],
    [0.891007, 0.309017, -0.987688, -0.156434, -0.951057, 0.453990],
    [0.913545, 0.275637, -0.990268, -0.139173, -0.961262, 0.406737],
    [0.933580, 0.241922, -0.992546, -0.121869, -0.970296, 0.358368],
    [0.951057, 0.207912, -0.994522, -0.104528, -0.978148, 0.309017],
    [0.965926, 0.173648, -0.996195, -0.087156, -0.984808, 0.258819],
    [0.978148, 0.139173, -0.997564, -0.069756, -0.990268, 0.207912],
    [0.987688, 0.104528, -0.998630, -0.052336, -0.994522, 0.156434],
    [0.994522, 0.069756, -0.999391, -0.034899, -0.997564, 0.104528],
    [0.998630, 0.034899, -0.999848, -0.017452, -0.999391, 0.052336],
    [1.000000, 0.000000, -1.000000, -0.000000, -1.000000, 0.000000],
    [0.998630, -0.034899, -0.999848, 0.017452, -0.999391, -0.052336],
    [0.994522, -0.069756, -0.999391, 0.034899, -0.997564, -0.104528],
    [0.987688, -0.104528, -0.998630, 0.052336, -0.994522, -0.156434],
    [0.978148, -0.139173, -0.997564, 0.069756, -0.990268, -0.207912],
    [0.965926, -0.173648, -0.996195, 0.087156, -0.984808, -0.258819],
    [0.951057, -0.207912, -0.994522, 0.104528, -0.978148, -0.309017],
    [0.933580, -0.241922, -0.992546, 0.121869, -0.970296, -0.358368],
    [0.913545, -0.275637, -0.990268, 0.139173, -0.961262, -0.406737],
    [0.891007, -0.309017, -0.987688, 0.156434, -0.951057, -0.453990],
    [0.866025, -0.342020, -0.984808, 0.173648, -0.939693, -0.500000],
    [0.838671, -0.374607, -0.981627, 0.190809, -0.927184, -0.544639],
    [0.809017, -0.406737, -0.978148, 0.207912, -0.913545, -0.587785],
    [0.777146, -0.438371, -0.974370, 0.224951, -0.898794, -0.629320],
    [0.743145, -0.469472, -0.970296, 0.241922, -0.882948, -0.669131],
    [0.707107, -0.500000, -0.965926, 0.258819, -0.866025, -0.707107],
    [0.669131, -0.529919, -0.961262, 0.275637, -0.848048, -0.743145],
    [0.629320, -0.559193, -0.956305, 0.292372, -0.829038, -0.777146],
    [0.587785, -0.587785, -0.951057, 0.309017, -0.809017, -0.809017],
    [0.544639, -0.615661, -0.945519, 0.325568, -0.788011, -0.838671],
    [0.500000, -0.642788, -0.939693, 0.342020, -0.766044, -0.866025],
    [0.453990, -0.669131, -0.933580, 0.358368, -0.743145, -0.891007],
    [0.406737, -0.694658, -0.927184, 0.374607, -0.719340, -0.913545],
    [0.358368, -0.719340, -0.920505, 0.390731, -0.694658, -0.933580],
    [0.309017, -0.743145, -0.913545, 0.406737, -0.669131, -0.951057],
    [0.258819, -0.766044, -0.906308, 0.422618, -0.642788, -0.965926],
    [0.207912, -0.788011, -0.898794, 0.438371, -0.615661, -0.978148],
    [0.156434, -0.809017, -0.891007, 0.453990, -0.587785, -0.987688],
    [0.104528, -0.829038, -0.882948, 0.469472, -0.559193, -0.994522],
    [0.052336, -0.848048, -0.874620, 0.484810, -0.529919, -0.998630],
    [0.000000, -0.866025, -0.866025, 0.500000, -0.500000, -1.000000],
    [-0.052336, -0.882948, -0.857167, 0.515038, -0.469472, -0.998630],
    [-0.104528, -0.898794, -0.848048, 0.529919, -0.438371, -0.994522],
    [-0.156434, -0.913545, -0.838671, 0.544639, -0.406737, -0.987688],
    [-0.207912, -0.927184, -0.829038, 0.559193, -0.374607, -0.978148],
    [-0.258819, -0.939693, -0.819152, 0.573576, -0.342020, -0.965926],
    [-0.309017, -0.951057, -0.809017, 0.587785, -0.309017, -0.951057],
    [-0.358368, -0.961262, -0.798636, 0.601815, -0.275637, -0.933580],
    [-0.406737, -0.970296, -0.788011, 0.615661, -0.241922, -0.913545],
    [-0.453990, -0.978148, -0.777146, 0.629320, -0.207912, -0.891007],
    [-0.500000, -0.984808, -0.766044, 0.642788, -0.173648, -0.866025],
    [-0.544639, -0.990268, -0.754710, 0.656059, -0.139173, -0.838671],
    [-0.587785, -0.994522, -0.743145, 0.669131, -0.104528, -0.809017],
    [-0.629320, -0.997564, -0.731354, 0.681998, -0.069756, -0.777146],
    [-0.669131, -0.999391, -0.719340, 0.694658, -0.034899, -0.743145],
    [-0.707107, -1.000000, -0.707107, 0.707107, -0.000000, -0.707107],
    [-0.743145, -0.999391, -0.694658, 0.719340, 0.034899, -0.669131],
    [-0.777146, -0.997564, -0.681998, 0.731354, 0.069756, -0.629320],
    [-0.809017, -0.994522, -0.669131, 0.743145, 0.104528, -0.587785],
    [-0.838671, -0.990268, -0.656059, 0.754710, 0.139173, -0.544639],
    [-0.866025, -0.984808, -0.642788, 0.766044, 0.173648, -0.500000],
    [-0.891007, -0.978148, -0.629320, 0.777146, 0.207912, -0.453990],
    [-0.913545, -0.970296, -0.615661, 0.788011, 0.241922, -0.406737],
    [-0.933580, -0.961262, -0.601815, 0.798636, 0.275637, -0.358368],
    [-0.951057, -0.951057, -0.587785, 0.809017, 0.309017, -0.309017],
    [-0.965926, -0.939693, -0.573576, 0.819152, 0.342020, -0.258819],
    [-0.978148, -0.927184, -0.559193, 0.829038, 0.374607, -0.207912],
    [-0.987688, -0.913545, -0.544639, 0.838671, 0.406737, -0.156434],
    [-0.994522, -0.898794, -0.529919, 0.848048, 0.438371, -0.104528],
    [-0.998630, -0.882948, -0.515038, 0.857167, 0.469472, -0.052336],
    [-1.000000, -0.866025, -0.500000, 0.866025, 0.500000, -0.000000],
    [-0.998630, -0.848048, -0.484810, 0.874620, 0.529919, 0.052336],
    [-0.994522, -0.829038, -0.469472, 0.882948, 0.559193, 0.104528],
    [-0.987688, -0.809017, -0.453990, 0.891007, 0.587785, 0.156434],
    [-0.978148, -0.788011, -0.438371, 0.898794, 0.615661, 0.207912],
    [-0.965926, -0.766044, -0.422618, 0.906308, 0.642788, 0.258819],
    [-0.951057, -0.743145, -0.406737, 0.913545, 0.669131, 0.309017],
    [-0.933580, -0.719340, -0.390731, 0.920505, 0.694658, 0.358368],
    [-0.913545, -0.694658, -0.374607, 0.927184, 0.719340, 0.406737],
    [-0.891007, -0.669131, -0.358368, 0.933580, 0.743145, 0.453990],
    [-0.866025, -0.642788, -0.342020, 0.939693, 0.766044, 0.500000],
    [-0.838671, -0.615661, -0.325568, 0.945519, 0.788011, 0.544639],
    [-0.809017, -0.587785, -0.309017, 0.951057, 0.809017, 0.587785],
    [-0.777146, -0.559193, -0.292372, 0.956305, 0.829038, 0.629320],
    [-0.743145, -0.529919, -0.275637, 0.961262, 0.848048, 0.669131],
    [-0.707107, -0.500000, -0.258819, 0.965926, 0.866025, 0.707107],
    [-0.669131, -0.469472, -0.241922, 0.970296, 0.882948, 0.743145],
    [-0.629320, -0.438371, -0.224951, 0.974370, 0.898794, 0.777146],
    [-0.587785, -0.406737, -0.207912, 0.978148, 0.913545, 0.809017],
    [-0.544639, -0.374607, -0.190809, 0.981627, 0.927184, 0.838671],
    [-0.500000, -0.342020, -0.173648, 0.984808, 0.939693, 0.866025],
    [-0.453990, -0.309017, -0.156434, 0.987688, 0.951057, 0.891007],
    [-0.406737, -0.275637, -0.139173, 0.990268, 0.961262, 0.913545],
    [-0.358368, -0.241922, -0.121869, 0.992546, 0.970296, 0.933580],
    [-0.309017, -0.207912, -0.104528, 0.994522, 0.978148, 0.951057],
    [-0.258819, -0.173648, -0.087156, 0.996195, 0.984808, 0.965926],
    [-0.207912, -0.139173, -0.069756, 0.997564, 0.990268, 0.978148],
    [-0.156434, -0.104528, -0.052336, 0.998630, 0.994522, 0.987688],
    [-0.104528, -0.069756, -0.034899, 0.999391, 0.997564, 0.994522],
    [-0.052336, -0.034899, -0.017452, 0.999848, 0.999391, 0.998630],
  ],
  [
    [-1.000000, -0.000000, 1.000000, -0.000000, 0.000000,
     -1.000000, -0.000000, 0.000000, -0.000000],
    [-0.999848, 0.017452, 0.999543, -0.030224, 0.000264,
     -0.999086, 0.042733, -0.000590, 0.000004],
    [-0.999391, 0.034899, 0.998173, -0.060411, 0.001055,
     -0.996348, 0.085356, -0.002357, 0.000034],
    [-0.998630, 0.052336, 0.995891, -0.090524, 0.002372,
     -0.991791, 0.127757, -0.005297, 0.000113],
    [-0.997564, 0.069756, 0.992701, -0.120527, 0.004214,
     -0.985429, 0.169828, -0.009400, 0.000268],
    [-0.996195, 0.087156, 0.988606, -0.150384, 0.006578,
     -0.977277, 0.211460, -0.014654, 0.000523],
    [-0.994522, 0.104528, 0.983611, -0.180057, 0.009462,
     -0.967356, 0.252544, -0.021043, 0.000903],
    [-0.992546, 0.121869, 0.977722, -0.209511, 0.012862,
     -0.955693, 0.292976, -0.028547, 0.001431],
    [-0.990268, 0.139173, 0.970946, -0.238709, 0.016774,
     -0.942316, 0.332649, -0.037143, 0.002131],
    [-0.987688, 0.156434, 0.963292, -0.267617, 0.021193,
     -0.927262, 0.371463, -0.046806, 0.003026],
    [-0.984808, 0.173648, 0.954769, -0.296198, 0.026114,
     -0.910569, 0.409317, -0.057505, 0.004140],
    [-0.981627, 0.190809, 0.945388, -0.324419, 0.031530,
     -0.892279, 0.446114, -0.069209, 0.005492],
    [-0.978148, 0.207912, 0.935159, -0.352244, 0.037436,
     -0.872441, 0.481759, -0.081880, 0.007105],
    [-0.974370, 0.224951, 0.924096, -0.379641, 0.043823,
     -0.851105, 0.516162, -0.095481, 0.008999],
    [-0.970296, 0.241922, 0.912211, -0.406574, 0.050685,
     -0.828326, 0.549233, -0.109969, 0.011193],
    [-0.965926, 0.258819, 0.899519, -0.433013, 0.058013,
     -0.804164, 0.580889, -0.125300, 0.013707],
    [-0.961262, 0.275637, 0.886036, -0.458924, 0.065797,
     -0.778680, 0.611050, -0.141427, 0.016556],
    [-0.956305, 0.292372, 0.871778, -0.484275, 0.074029,
     -0.751940, 0.639639, -0.158301, 0.019758],
    [-0.951057, 0.309017, 0.856763, -0.509037, 0.082698,
     -0.724012, 0.666583, -0.175868, 0.023329],
    [-0.945519, 0.325568, 0.841008, -0.533178, 0.091794,
     -0.694969, 0.691816, -0.194075, 0.027281],
    [-0.939693, 0.342020, 0.824533, -0.556670, 0.101306,
     -0.664885, 0.715274, -0.212865, 0.031630],
    [-0.933580, 0.358368, 0.807359, -0.579484, 0.111222,
     -0.633837, 0.736898, -0.232180, 0.036385],
    [-0.927184, 0.374607, 0.789505, -0.601592, 0.121529,
     -0.601904, 0.756637, -0.251960, 0.041559],
    [-0.920505, 0.390731, 0.770994, -0.622967, 0.132217,
     -0.569169, 0.774442, -0.272143, 0.047160],
    [-0.913545, 0.406737, 0.751848, -0.643582, 0.143271,
     -0.535715, 0.790270, -0.292666, 0.053196],
    [-0.906308, 0.422618, 0.732091, -0.663414, 0.154678,
     -0.501627, 0.804083, -0.313464, 0.059674],
    [-0.898794, 0.438371, 0.711746, -0.682437, 0.166423,
     -0.466993, 0.815850, -0.334472, 0.066599],
    [-0.891007, 0.453990, 0.690839, -0.700629, 0.178494,
     -0.431899, 0.825544, -0.355623, 0.073974],
    [-0.882948, 0.469472, 0.669395, -0.717968, 0.190875,
     -0.396436, 0.833145, -0.376851, 0.081803],
    [-0.874620, 0.484810, 0.647439, -0.734431, 0.203551,
     -0.360692, 0.838638, -0.398086, 0.090085],
    [-0.866025, 0.500000, 0.625000, -0.750000, 0.216506,
     -0.324760, 0.842012, -0.419263, 0.098821],
    [-0.857167, 0.515038, 0.602104, -0.764655, 0.229726,
     -0.288728, 0.843265, -0.440311, 0.108009],
    [-0.848048, 0.529919, 0.578778, -0.778378, 0.243192,
     -0.252688, 0.842399, -0.461164, 0.117644],
    [-0.838671, 0.544639, 0.555052, -0.791154, 0.256891,
     -0.216730, 0.839422, -0.481753, 0.127722],
    [-0.829038, 0.559193, 0.530955, -0.802965, 0.270803,
     -0.180944, 0.834347, -0.502011, 0.138237],
    [-0.819152, 0.573576, 0.506515, -0.813798, 0.284914,
     -0.145420, 0.827194, -0.521871, 0.149181],
    [-0.809017, 0.587785, 0.481763, -0.823639, 0.299204,
     -0.110246, 0.817987, -0.541266, 0.160545],
    [-0.798636, 0.601815, 0.456728, -0.832477, 0.313658,
     -0.075508, 0.806757, -0.560132, 0.172317],
    [-0.788011, 0.615661, 0.431441, -0.840301, 0.328257,
     -0.041294, 0.793541, -0.578405, 0.184487],
    [-0.777146, 0.629320, 0.405934, -0.847101, 0.342984,
     -0.007686, 0.778379, -0.596021, 0.197040],
    [-0.766044, 0.642788, 0.380236, -0.852869, 0.357821,
     0.025233, 0.761319, -0.612921, 0.209963],
    [-0.754710, 0.656059, 0.354380, -0.857597, 0.372749,
     0.057383, 0.742412, -0.629044, 0.223238],
    [-0.743145, 0.669131, 0.328396, -0.861281, 0.387751,
     0.088686, 0.721714, -0.644334, 0.236850],
    [-0.731354, 0.681998, 0.302317, -0.863916, 0.402807,
     0.119068, 0.699288, -0.658734, 0.250778],
    [-0.719340, 0.694658, 0.276175, -0.865498, 0.417901,
     0.148454, 0.675199, -0.672190, 0.265005],
    [-0.707107, 0.707107, 0.250000, -0.866025, 0.433013,
     0.176777, 0.649519, -0.684653, 0.279508],
    [-0.694658, 0.719340, 0.223825, -0.865498, 0.448125,
     0.203969, 0.622322, -0.696073, 0.294267],
    [-0.681998, 0.731354, 0.197683, -0.863916, 0.463218,
     0.229967, 0.593688, -0.706405, 0.309259],
    [-0.669131, 0.743145, 0.171604, -0.861281, 0.478275,
     0.254712, 0.563700, -0.715605, 0.324459],
    [-0.656059, 0.754710, 0.145620, -0.857597, 0.493276,
     0.278147, 0.532443, -0.723633, 0.339844],
    [-0.642788, 0.766044, 0.119764, -0.852869, 0.508205,
     0.300221, 0.500009, -0.730451, 0.355387],
    [-0.629320, 0.777146, 0.094066, -0.847101, 0.523041,
     0.320884, 0.466490, -0.736025, 0.371063],
    [-0.615661, 0.788011, 0.068559, -0.840301, 0.537768,
     0.340093, 0.431982, -0.740324, 0.386845],
    [-0.601815, 0.798636, 0.043272, -0.832477, 0.552367,
     0.357807, 0.396584, -0.743320, 0.402704],
    [-0.587785, 0.809017, 0.018237, -0.823639, 0.566821,
     0.373991, 0.360397, -0.744989, 0.418613],
    [-0.573576, 0.819152, -0.006515, -0.813798, 0.581112,
     0.388612, 0.323524, -0.745308, 0.434544],
    [-0.559193, 0.829038, -0.030955, -0.802965, 0.595222,
     0.401645, 0.286069, -0.744262, 0.450467],
    [-0.544639, 0.838671, -0.055052, -0.791154, 0.609135,
     0.413066, 0.248140, -0.741835, 0.466352],
    [-0.529919, 0.848048, -0.078778, -0.778378, 0.622833,
     0.422856, 0.209843, -0.738017, 0.482171],
    [-0.515038, 0.857167, -0.102104, -0.764655, 0.636300,
     0.431004, 0.171288, -0.732801, 0.497894],
    [-0.500000, 0.866025, -0.125000, -0.750000, 0.649519,
     0.437500, 0.132583, -0.726184, 0.513490],
    [-0.484810, 0.874620, -0.147439, -0.734431, 0.662474,
     0.442340, 0.093837, -0.718167, 0.528929],
    [-0.469472, 0.882948, -0.169395, -0.717968, 0.675150,
     0.445524, 0.055160, -0.708753, 0.544183],
    [-0.453990, 0.891007, -0.190839, -0.700629, 0.687531,
     0.447059, 0.016662, -0.697950, 0.559220],
    [-0.438371, 0.898794, -0.211746, -0.682437, 0.699602,
     0.446953, -0.021550, -0.685769, 0.574011],
    [-0.422618, 0.906308, -0.232091, -0.663414, 0.711348,
     0.445222, -0.059368, -0.672226, 0.588528],
    [-0.406737, 0.913545, -0.251848, -0.643582, 0.722755,
     0.441884, -0.096684, -0.657339, 0.602741],
    [-0.390731, 0.920505, -0.270994, -0.622967, 0.733809,
     0.436964, -0.133395, -0.641130, 0.616621],
    [-0.374607, 0.927184, -0.289505, -0.601592, 0.744496,
     0.430488, -0.169397, -0.623624, 0.630141],
    [-0.358368, 0.933580, -0.307359, -0.579484, 0.754804,
     0.422491, -0.204589, -0.604851, 0.643273],
    [-0.342020, 0.939693, -0.324533, -0.556670, 0.764720,
     0.413008, -0.238872, -0.584843, 0.655990],
    [-0.325568, 0.945519, -0.341008, -0.533178, 0.774231,
     0.402081, -0.272150, -0.563635, 0.668267],
    [-0.309017, 0.951057, -0.356763, -0.509037, 0.783327,
     0.389754, -0.304329, -0.541266, 0.680078],
    [-0.292372, 0.956305, -0.371778, -0.484275, 0.791997,
     0.376077, -0.335319, -0.517778, 0.691399],
    [-0.275637, 0.961262, -0.386036, -0.458924, 0.800228,
     0.361102, -0.365034, -0.493216, 0.702207],
    [-0.258819, 0.965926, -0.399519, -0.433013, 0.808013,
     0.344885, -0.393389, -0.467627, 0.712478],
    [-0.241922, 0.970296, -0.412211, -0.406574, 0.815340,
     0.327486, -0.420306, -0.441061, 0.722191],
    [-0.224951, 0.974370, -0.424096, -0.379641, 0.822202,
     0.308969, -0.445709, -0.413572, 0.731327],
    [-0.207912, 0.978148, -0.435159, -0.352244, 0.828589,
     0.289399, -0.469527, -0.385215, 0.739866],
    [-0.190809, 0.981627, -0.445388, -0.324419, 0.834495,
     0.268846, -0.491693, -0.356047, 0.747790],
    [-0.173648, 0.984808, -0.454769, -0.296198, 0.839912,
     0.247382, -0.512145, -0.326129, 0.755082],
    [-0.156434, 0.987688, -0.463292, -0.267617, 0.844832,
     0.225081, -0.530827, -0.295521, 0.761728],
    [-0.139173, 0.990268, -0.470946, -0.238709, 0.849251,
     0.202020, -0.547684, -0.264287, 0.767712],
    [-0.121869, 0.992546, -0.477722, -0.209511, 0.853163,
     0.178279, -0.562672, -0.232494, 0.773023],
    [-0.104528, 0.994522, -0.483611, -0.180057, 0.856563,
     0.153937, -0.575747, -0.200207, 0.777648],
    [-0.087156, 0.996195, -0.488606, -0.150384, 0.859447,
     0.129078, -0.586872, -0.167494, 0.781579],
    [-0.069756, 0.997564, -0.492701, -0.120527, 0.861811,
     0.103786, -0.596018, -0.134426, 0.784806],
    [-0.052336, 0.998630, -0.495891, -0.090524, 0.863653,
     0.078146, -0.603158, -0.101071, 0.787324],
    [-0.034899, 0.999391, -0.498173, -0.060411, 0.864971,
     0.052243, -0.608272, -0.067500, 0.789126],
    [-0.017452, 0.999848, -0.499543, -0.030224, 0.865762,
     0.026165, -0.611347, -0.033786, 0.790208],
    [0.000000, 1.000000, -0.500000, 0.000000, 0.866025,
     -0.000000, -0.612372, 0.000000, 0.790569],
    [0.017452, 0.999848, -0.499543, 0.030224, 0.865762,
     -0.026165, -0.611347, 0.033786, 0.790208],
    [0.034899, 0.999391, -0.498173, 0.060411, 0.864971,
     -0.052243, -0.608272, 0.067500, 0.789126],
    [0.052336, 0.998630, -0.495891, 0.090524, 0.863653,
     -0.078146, -0.603158, 0.101071, 0.787324],
    [0.069756, 0.997564, -0.492701, 0.120527, 0.861811,
     -0.103786, -0.596018, 0.134426, 0.784806],
    [0.087156, 0.996195, -0.488606, 0.150384, 0.859447,
     -0.129078, -0.586872, 0.167494, 0.781579],
    [0.104528, 0.994522, -0.483611, 0.180057, 0.856563,
     -0.153937, -0.575747, 0.200207, 0.777648],
    [0.121869, 0.992546, -0.477722, 0.209511, 0.853163,
     -0.178279, -0.562672, 0.232494, 0.773023],
    [0.139173, 0.990268, -0.470946, 0.238709, 0.849251,
     -0.202020, -0.547684, 0.264287, 0.767712],
    [0.156434, 0.987688, -0.463292, 0.267617, 0.844832,
     -0.225081, -0.530827, 0.295521, 0.761728],
    [0.173648, 0.984808, -0.454769, 0.296198, 0.839912,
     -0.247382, -0.512145, 0.326129, 0.755082],
    [0.190809, 0.981627, -0.445388, 0.324419, 0.834495,
     -0.268846, -0.491693, 0.356047, 0.747790],
    [0.207912, 0.978148, -0.435159, 0.352244, 0.828589,
     -0.289399, -0.469527, 0.385215, 0.739866],
    [0.224951, 0.974370, -0.424096, 0.379641, 0.822202,
     -0.308969, -0.445709, 0.413572, 0.731327],
    [0.241922, 0.970296, -0.412211, 0.406574, 0.815340,
     -0.327486, -0.420306, 0.441061, 0.722191],
    [0.258819, 0.965926, -0.399519, 0.433013, 0.808013,
     -0.344885, -0.393389, 0.467627, 0.712478],
    [0.275637, 0.961262, -0.386036, 0.458924, 0.800228,
     -0.361102, -0.365034, 0.493216, 0.702207],
    [0.292372, 0.956305, -0.371778, 0.484275, 0.791997,
     -0.376077, -0.335319, 0.517778, 0.691399],
    [0.309017, 0.951057, -0.356763, 0.509037, 0.783327,
     -0.389754, -0.304329, 0.541266, 0.680078],
    [0.325568, 0.945519, -0.341008, 0.533178, 0.774231,
     -0.402081, -0.272150, 0.563635, 0.668267],
    [0.342020, 0.939693, -0.324533, 0.556670, 0.764720,
     -0.413008, -0.238872, 0.584843, 0.655990],
    [0.358368, 0.933580, -0.307359, 0.579484, 0.754804,
     -0.422491, -0.204589, 0.604851, 0.643273],
    [0.374607, 0.927184, -0.289505, 0.601592, 0.744496,
     -0.430488, -0.169397, 0.623624, 0.630141],
    [0.390731, 0.920505, -0.270994, 0.622967, 0.733809,
     -0.436964, -0.133395, 0.641130, 0.616621],
    [0.406737, 0.913545, -0.251848, 0.643582, 0.722755,
     -0.441884, -0.096684, 0.657339, 0.602741],
    [0.422618, 0.906308, -0.232091, 0.663414, 0.711348,
     -0.445222, -0.059368, 0.672226, 0.588528],
    [0.438371, 0.898794, -0.211746, 0.682437, 0.699602,
     -0.446953, -0.021550, 0.685769, 0.574011],
    [0.453990, 0.891007, -0.190839, 0.700629, 0.687531,
     -0.447059, 0.016662, 0.697950, 0.559220],
    [0.469472, 0.882948, -0.169395, 0.717968, 0.675150,
     -0.445524, 0.055160, 0.708753, 0.544183],
    [0.484810, 0.874620, -0.147439, 0.734431, 0.662474,
     -0.442340, 0.093837, 0.718167, 0.528929],
    [0.500000, 0.866025, -0.125000, 0.750000, 0.649519,
     -0.437500, 0.132583, 0.726184, 0.513490],
    [0.515038, 0.857167, -0.102104, 0.764655, 0.636300,
     -0.431004, 0.171288, 0.732801, 0.497894],
    [0.529919, 0.848048, -0.078778, 0.778378, 0.622833,
     -0.422856, 0.209843, 0.738017, 0.482171],
    [0.544639, 0.838671, -0.055052, 0.791154, 0.609135,
     -0.413066, 0.248140, 0.741835, 0.466352],
    [0.559193, 0.829038, -0.030955, 0.802965, 0.595222,
     -0.401645, 0.286069, 0.744262, 0.450467],
    [0.573576, 0.819152, -0.006515, 0.813798, 0.581112,
     -0.388612, 0.323524, 0.745308, 0.434544],
    [0.587785, 0.809017, 0.018237, 0.823639, 0.566821,
     -0.373991, 0.360397, 0.744989, 0.418613],
    [0.601815, 0.798636, 0.043272, 0.832477, 0.552367,
     -0.357807, 0.396584, 0.743320, 0.402704],
    [0.615661, 0.788011, 0.068559, 0.840301, 0.537768,
     -0.340093, 0.431982, 0.740324, 0.386845],
    [0.629320, 0.777146, 0.094066, 0.847101, 0.523041,
     -0.320884, 0.466490, 0.736025, 0.371063],
    [0.642788, 0.766044, 0.119764, 0.852869, 0.508205,
     -0.300221, 0.500009, 0.730451, 0.355387],
    [0.656059, 0.754710, 0.145620, 0.857597, 0.493276,
     -0.278147, 0.532443, 0.723633, 0.339844],
    [0.669131, 0.743145, 0.171604, 0.861281, 0.478275,
     -0.254712, 0.563700, 0.715605, 0.324459],
    [0.681998, 0.731354, 0.197683, 0.863916, 0.463218,
     -0.229967, 0.593688, 0.706405, 0.309259],
    [0.694658, 0.719340, 0.223825, 0.865498, 0.448125,
     -0.203969, 0.622322, 0.696073, 0.294267],
    [0.707107, 0.707107, 0.250000, 0.866025, 0.433013,
     -0.176777, 0.649519, 0.684653, 0.279508],
    [0.719340, 0.694658, 0.276175, 0.865498, 0.417901,
     -0.148454, 0.675199, 0.672190, 0.265005],
    [0.731354, 0.681998, 0.302317, 0.863916, 0.402807,
     -0.119068, 0.699288, 0.658734, 0.250778],
    [0.743145, 0.669131, 0.328396, 0.861281, 0.387751,
     -0.088686, 0.721714, 0.644334, 0.236850],
    [0.754710, 0.656059, 0.354380, 0.857597, 0.372749,
     -0.057383, 0.742412, 0.629044, 0.223238],
    [0.766044, 0.642788, 0.380236, 0.852869, 0.357821,
     -0.025233, 0.761319, 0.612921, 0.209963],
    [0.777146, 0.629320, 0.405934, 0.847101, 0.342984,
     0.007686, 0.778379, 0.596021, 0.197040],
    [0.788011, 0.615661, 0.431441, 0.840301, 0.328257,
     0.041294, 0.793541, 0.578405, 0.184487],
    [0.798636, 0.601815, 0.456728, 0.832477, 0.313658,
     0.075508, 0.806757, 0.560132, 0.172317],
    [0.809017, 0.587785, 0.481763, 0.823639, 0.299204,
     0.110246, 0.817987, 0.541266, 0.160545],
    [0.819152, 0.573576, 0.506515, 0.813798, 0.284914,
     0.145420, 0.827194, 0.521871, 0.149181],
    [0.829038, 0.559193, 0.530955, 0.802965, 0.270803,
     0.180944, 0.834347, 0.502011, 0.138237],
    [0.838671, 0.544639, 0.555052, 0.791154, 0.256891,
     0.216730, 0.839422, 0.481753, 0.127722],
    [0.848048, 0.529919, 0.578778, 0.778378, 0.243192,
     0.252688, 0.842399, 0.461164, 0.117644],
    [0.857167, 0.515038, 0.602104, 0.764655, 0.229726,
     0.288728, 0.843265, 0.440311, 0.108009],
    [0.866025, 0.500000, 0.625000, 0.750000, 0.216506,
     0.324760, 0.842012, 0.419263, 0.098821],
    [0.874620, 0.484810, 0.647439, 0.734431, 0.203551,
     0.360692, 0.838638, 0.398086, 0.090085],
    [0.882948, 0.469472, 0.669395, 0.717968, 0.190875,
     0.396436, 0.833145, 0.376851, 0.081803],
    [0.891007, 0.453990, 0.690839, 0.700629, 0.178494,
     0.431899, 0.825544, 0.355623, 0.073974],
    [0.898794, 0.438371, 0.711746, 0.682437, 0.166423,
     0.466993, 0.815850, 0.334472, 0.066599],
    [0.906308, 0.422618, 0.732091, 0.663414, 0.154678,
     0.501627, 0.804083, 0.313464, 0.059674],
    [0.913545, 0.406737, 0.751848, 0.643582, 0.143271,
     0.535715, 0.790270, 0.292666, 0.053196],
    [0.920505, 0.390731, 0.770994, 0.622967, 0.132217,
     0.569169, 0.774442, 0.272143, 0.047160],
    [0.927184, 0.374607, 0.789505, 0.601592, 0.121529,
     0.601904, 0.756637, 0.251960, 0.041559],
    [0.933580, 0.358368, 0.807359, 0.579484, 0.111222,
     0.633837, 0.736898, 0.232180, 0.036385],
    [0.939693, 0.342020, 0.824533, 0.556670, 0.101306,
     0.664885, 0.715274, 0.212865, 0.031630],
    [0.945519, 0.325568, 0.841008, 0.533178, 0.091794,
     0.694969, 0.691816, 0.194075, 0.027281],
    [0.951057, 0.309017, 0.856763, 0.509037, 0.082698,
     0.724012, 0.666583, 0.175868, 0.023329],
    [0.956305, 0.292372, 0.871778, 0.484275, 0.074029,
     0.751940, 0.639639, 0.158301, 0.019758],
    [0.961262, 0.275637, 0.886036, 0.458924, 0.065797,
     0.778680, 0.611050, 0.141427, 0.016556],
    [0.965926, 0.258819, 0.899519, 0.433013, 0.058013,
     0.804164, 0.580889, 0.125300, 0.013707],
    [0.970296, 0.241922, 0.912211, 0.406574, 0.050685,
     0.828326, 0.549233, 0.109969, 0.011193],
    [0.974370, 0.224951, 0.924096, 0.379641, 0.043823,
     0.851105, 0.516162, 0.095481, 0.008999],
    [0.978148, 0.207912, 0.935159, 0.352244, 0.037436,
     0.872441, 0.481759, 0.081880, 0.007105],
    [0.981627, 0.190809, 0.945388, 0.324419, 0.031530,
     0.892279, 0.446114, 0.069209, 0.005492],
    [0.984808, 0.173648, 0.954769, 0.296198, 0.026114,
     0.910569, 0.409317, 0.057505, 0.004140],
    [0.987688, 0.156434, 0.963292, 0.267617, 0.021193,
     0.927262, 0.371463, 0.046806, 0.003026],
    [0.990268, 0.139173, 0.970946, 0.238709, 0.016774,
     0.942316, 0.332649, 0.037143, 0.002131],
    [0.992546, 0.121869, 0.977722, 0.209511, 0.012862,
     0.955693, 0.292976, 0.028547, 0.001431],
    [0.994522, 0.104528, 0.983611, 0.180057, 0.009462,
     0.967356, 0.252544, 0.021043, 0.000903],
    [0.996195, 0.087156, 0.988606, 0.150384, 0.006578,
     0.977277, 0.211460, 0.014654, 0.000523],
    [0.997564, 0.069756, 0.992701, 0.120527, 0.004214,
     0.985429, 0.169828, 0.009400, 0.000268],
    [0.998630, 0.052336, 0.995891, 0.090524, 0.002372,
     0.991791, 0.127757, 0.005297, 0.000113],
    [0.999391, 0.034899, 0.998173, 0.060411, 0.001055,
     0.996348, 0.085356, 0.002357, 0.000034],
    [0.999848, 0.017452, 0.999543, 0.030224, 0.000264,
     0.999086, 0.042733, 0.000590, 0.000004],
    [1.000000, -0.000000, 1.000000, -0.000000, 0.000000,
     1.000000, -0.000000, 0.000000, -0.000000],
  ],
];


/** @type {Number} */
const SPHERICAL_HARMONICS_AZIMUTH_RESOLUTION =
  SPHERICAL_HARMONICS[0].length;


/** @type {Number} */
const SPHERICAL_HARMONICS_ELEVATION_RESOLUTION =
  SPHERICAL_HARMONICS[1].length;


/**
 * The maximum allowed ambisonic order.
 * @type {Number}
 */
const SPHERICAL_HARMONICS_MAX_ORDER =
  SPHERICAL_HARMONICS[0][0].length / 2;


/**
 * Pre-computed per-band weighting coefficients for producing energy-preserving
 * Max-Re sources.
 */
const MAX_RE_WEIGHTS =
[
  [1.000000, 1.000000, 1.000000, 1.000000],
  [1.000000, 1.000000, 1.000000, 1.000000],
  [1.000000, 1.000000, 1.000000, 1.000000],
  [1.000000, 1.000000, 1.000000, 1.000000],
  [1.000000, 1.000000, 1.000000, 1.000000],
  [1.000000, 1.000000, 1.000000, 1.000000],
  [1.000000, 1.000000, 1.000000, 1.000000],
  [1.000000, 1.000000, 1.000000, 1.000000],
  [1.000000, 1.000000, 1.000000, 1.000000],
  [1.000000, 1.000000, 1.000000, 1.000000],
  [1.000000, 1.000000, 1.000000, 1.000000],
  [1.000000, 1.000000, 1.000000, 1.000000],
  [1.000000, 1.000000, 1.000000, 1.000000],
  [1.000000, 1.000000, 1.000000, 1.000000],
  [1.000000, 1.000000, 1.000000, 1.000000],
  [1.000000, 1.000000, 1.000000, 1.000000],
  [1.000000, 1.000000, 1.000000, 1.000000],
  [1.000000, 1.000000, 1.000000, 1.000000],
  [1.000000, 1.000000, 1.000000, 1.000000],
  [1.000000, 1.000000, 1.000000, 1.000000],
  [1.000000, 1.000000, 1.000000, 1.000000],
  [1.000000, 1.000000, 1.000000, 1.000000],
  [1.000000, 1.000000, 1.000000, 1.000000],
  [1.000000, 1.000000, 1.000000, 1.000000],
  [1.000000, 1.000000, 1.000000, 1.000000],
  [1.000000, 1.000000, 1.000000, 1.000000],
  [1.000000, 1.000000, 1.000000, 1.000000],
  [1.000000, 1.000000, 1.000000, 1.000000],
  [1.000000, 1.000000, 1.000000, 1.000000],
  [1.000000, 1.000000, 1.000000, 1.000000],
  [1.003236, 1.002156, 0.999152, 0.990038],
  [1.032370, 1.021194, 0.990433, 0.898572],
  [1.062694, 1.040231, 0.979161, 0.799806],
  [1.093999, 1.058954, 0.964976, 0.693603],
  [1.126003, 1.077006, 0.947526, 0.579890],
  [1.158345, 1.093982, 0.926474, 0.458690],
  [1.190590, 1.109437, 0.901512, 0.330158],
  [1.222228, 1.122890, 0.872370, 0.194621],
  [1.252684, 1.133837, 0.838839, 0.052614],
  [1.281987, 1.142358, 0.801199, 0.000000],
  [1.312073, 1.150207, 0.760839, 0.000000],
  [1.343011, 1.157424, 0.717799, 0.000000],
  [1.374649, 1.163859, 0.671999, 0.000000],
  [1.406809, 1.169354, 0.623371, 0.000000],
  [1.439286, 1.173739, 0.571868, 0.000000],
  [1.471846, 1.176837, 0.517465, 0.000000],
  [1.504226, 1.178465, 0.460174, 0.000000],
  [1.536133, 1.178438, 0.400043, 0.000000],
  [1.567253, 1.176573, 0.337165, 0.000000],
  [1.597247, 1.172695, 0.271688, 0.000000],
  [1.625766, 1.166645, 0.203815, 0.000000],
  [1.652455, 1.158285, 0.133806, 0.000000],
  [1.676966, 1.147506, 0.061983, 0.000000],
  [1.699006, 1.134261, 0.000000, 0.000000],
  [1.720224, 1.119789, 0.000000, 0.000000],
  [1.741631, 1.104810, 0.000000, 0.000000],
  [1.763183, 1.089330, 0.000000, 0.000000],
  [1.784837, 1.073356, 0.000000, 0.000000],
  [1.806548, 1.056898, 0.000000, 0.000000],
  [1.828269, 1.039968, 0.000000, 0.000000],
  [1.849952, 1.022580, 0.000000, 0.000000],
  [1.871552, 1.004752, 0.000000, 0.000000],
  [1.893018, 0.986504, 0.000000, 0.000000],
  [1.914305, 0.967857, 0.000000, 0.000000],
  [1.935366, 0.948837, 0.000000, 0.000000],
  [1.956154, 0.929471, 0.000000, 0.000000],
  [1.976625, 0.909790, 0.000000, 0.000000],
  [1.996736, 0.889823, 0.000000, 0.000000],
  [2.016448, 0.869607, 0.000000, 0.000000],
  [2.035721, 0.849175, 0.000000, 0.000000],
  [2.054522, 0.828565, 0.000000, 0.000000],
  [2.072818, 0.807816, 0.000000, 0.000000],
  [2.090581, 0.786964, 0.000000, 0.000000],
  [2.107785, 0.766051, 0.000000, 0.000000],
  [2.124411, 0.745115, 0.000000, 0.000000],
  [2.140439, 0.724196, 0.000000, 0.000000],
  [2.155856, 0.703332, 0.000000, 0.000000],
  [2.170653, 0.682561, 0.000000, 0.000000],
  [2.184823, 0.661921, 0.000000, 0.000000],
  [2.198364, 0.641445, 0.000000, 0.000000],
  [2.211275, 0.621169, 0.000000, 0.000000],
  [2.223562, 0.601125, 0.000000, 0.000000],
  [2.235230, 0.581341, 0.000000, 0.000000],
  [2.246289, 0.561847, 0.000000, 0.000000],
  [2.256751, 0.542667, 0.000000, 0.000000],
  [2.266631, 0.523826, 0.000000, 0.000000],
  [2.275943, 0.505344, 0.000000, 0.000000],
  [2.284707, 0.487239, 0.000000, 0.000000],
  [2.292939, 0.469528, 0.000000, 0.000000],
  [2.300661, 0.452225, 0.000000, 0.000000],
  [2.307892, 0.435342, 0.000000, 0.000000],
  [2.314654, 0.418888, 0.000000, 0.000000],
  [2.320969, 0.402870, 0.000000, 0.000000],
  [2.326858, 0.387294, 0.000000, 0.000000],
  [2.332343, 0.372164, 0.000000, 0.000000],
  [2.337445, 0.357481, 0.000000, 0.000000],
  [2.342186, 0.343246, 0.000000, 0.000000],
  [2.346585, 0.329458, 0.000000, 0.000000],
  [2.350664, 0.316113, 0.000000, 0.000000],
  [2.354442, 0.303208, 0.000000, 0.000000],
  [2.357937, 0.290738, 0.000000, 0.000000],
  [2.361168, 0.278698, 0.000000, 0.000000],
  [2.364152, 0.267080, 0.000000, 0.000000],
  [2.366906, 0.255878, 0.000000, 0.000000],
  [2.369446, 0.245082, 0.000000, 0.000000],
  [2.371786, 0.234685, 0.000000, 0.000000],
  [2.373940, 0.224677, 0.000000, 0.000000],
  [2.375923, 0.215048, 0.000000, 0.000000],
  [2.377745, 0.205790, 0.000000, 0.000000],
  [2.379421, 0.196891, 0.000000, 0.000000],
  [2.380959, 0.188342, 0.000000, 0.000000],
  [2.382372, 0.180132, 0.000000, 0.000000],
  [2.383667, 0.172251, 0.000000, 0.000000],
  [2.384856, 0.164689, 0.000000, 0.000000],
  [2.385945, 0.157435, 0.000000, 0.000000],
  [2.386943, 0.150479, 0.000000, 0.000000],
  [2.387857, 0.143811, 0.000000, 0.000000],
  [2.388694, 0.137421, 0.000000, 0.000000],
  [2.389460, 0.131299, 0.000000, 0.000000],
  [2.390160, 0.125435, 0.000000, 0.000000],
  [2.390801, 0.119820, 0.000000, 0.000000],
  [2.391386, 0.114445, 0.000000, 0.000000],
  [2.391921, 0.109300, 0.000000, 0.000000],
  [2.392410, 0.104376, 0.000000, 0.000000],
  [2.392857, 0.099666, 0.000000, 0.000000],
  [2.393265, 0.095160, 0.000000, 0.000000],
  [2.393637, 0.090851, 0.000000, 0.000000],
  [2.393977, 0.086731, 0.000000, 0.000000],
  [2.394288, 0.082791, 0.000000, 0.000000],
  [2.394571, 0.079025, 0.000000, 0.000000],
  [2.394829, 0.075426, 0.000000, 0.000000],
  [2.395064, 0.071986, 0.000000, 0.000000],
  [2.395279, 0.068699, 0.000000, 0.000000],
  [2.395475, 0.065558, 0.000000, 0.000000],
  [2.395653, 0.062558, 0.000000, 0.000000],
  [2.395816, 0.059693, 0.000000, 0.000000],
  [2.395964, 0.056955, 0.000000, 0.000000],
  [2.396099, 0.054341, 0.000000, 0.000000],
  [2.396222, 0.051845, 0.000000, 0.000000],
  [2.396334, 0.049462, 0.000000, 0.000000],
  [2.396436, 0.047186, 0.000000, 0.000000],
  [2.396529, 0.045013, 0.000000, 0.000000],
  [2.396613, 0.042939, 0.000000, 0.000000],
  [2.396691, 0.040959, 0.000000, 0.000000],
  [2.396761, 0.039069, 0.000000, 0.000000],
  [2.396825, 0.037266, 0.000000, 0.000000],
  [2.396883, 0.035544, 0.000000, 0.000000],
  [2.396936, 0.033901, 0.000000, 0.000000],
  [2.396984, 0.032334, 0.000000, 0.000000],
  [2.397028, 0.030838, 0.000000, 0.000000],
  [2.397068, 0.029410, 0.000000, 0.000000],
  [2.397104, 0.028048, 0.000000, 0.000000],
  [2.397137, 0.026749, 0.000000, 0.000000],
  [2.397167, 0.025509, 0.000000, 0.000000],
  [2.397194, 0.024326, 0.000000, 0.000000],
  [2.397219, 0.023198, 0.000000, 0.000000],
  [2.397242, 0.022122, 0.000000, 0.000000],
  [2.397262, 0.021095, 0.000000, 0.000000],
  [2.397281, 0.020116, 0.000000, 0.000000],
  [2.397298, 0.019181, 0.000000, 0.000000],
  [2.397314, 0.018290, 0.000000, 0.000000],
  [2.397328, 0.017441, 0.000000, 0.000000],
  [2.397341, 0.016630, 0.000000, 0.000000],
  [2.397352, 0.015857, 0.000000, 0.000000],
  [2.397363, 0.015119, 0.000000, 0.000000],
  [2.397372, 0.014416, 0.000000, 0.000000],
  [2.397381, 0.013745, 0.000000, 0.000000],
  [2.397389, 0.013106, 0.000000, 0.000000],
  [2.397396, 0.012496, 0.000000, 0.000000],
  [2.397403, 0.011914, 0.000000, 0.000000],
  [2.397409, 0.011360, 0.000000, 0.000000],
  [2.397414, 0.010831, 0.000000, 0.000000],
  [2.397419, 0.010326, 0.000000, 0.000000],
  [2.397424, 0.009845, 0.000000, 0.000000],
  [2.397428, 0.009387, 0.000000, 0.000000],
  [2.397432, 0.008949, 0.000000, 0.000000],
  [2.397435, 0.008532, 0.000000, 0.000000],
  [2.397438, 0.008135, 0.000000, 0.000000],
  [2.397441, 0.007755, 0.000000, 0.000000],
  [2.397443, 0.007394, 0.000000, 0.000000],
  [2.397446, 0.007049, 0.000000, 0.000000],
  [2.397448, 0.006721, 0.000000, 0.000000],
  [2.397450, 0.006407, 0.000000, 0.000000],
  [2.397451, 0.006108, 0.000000, 0.000000],
  [2.397453, 0.005824, 0.000000, 0.000000],
  [2.397454, 0.005552, 0.000000, 0.000000],
  [2.397456, 0.005293, 0.000000, 0.000000],
  [2.397457, 0.005046, 0.000000, 0.000000],
  [2.397458, 0.004811, 0.000000, 0.000000],
  [2.397459, 0.004586, 0.000000, 0.000000],
  [2.397460, 0.004372, 0.000000, 0.000000],
  [2.397461, 0.004168, 0.000000, 0.000000],
  [2.397461, 0.003974, 0.000000, 0.000000],
  [2.397462, 0.003788, 0.000000, 0.000000],
  [2.397463, 0.003611, 0.000000, 0.000000],
  [2.397463, 0.003443, 0.000000, 0.000000],
  [2.397464, 0.003282, 0.000000, 0.000000],
  [2.397464, 0.003129, 0.000000, 0.000000],
  [2.397465, 0.002983, 0.000000, 0.000000],
  [2.397465, 0.002844, 0.000000, 0.000000],
  [2.397465, 0.002711, 0.000000, 0.000000],
  [2.397466, 0.002584, 0.000000, 0.000000],
  [2.397466, 0.002464, 0.000000, 0.000000],
  [2.397466, 0.002349, 0.000000, 0.000000],
  [2.397466, 0.002239, 0.000000, 0.000000],
  [2.397467, 0.002135, 0.000000, 0.000000],
  [2.397467, 0.002035, 0.000000, 0.000000],
  [2.397467, 0.001940, 0.000000, 0.000000],
  [2.397467, 0.001849, 0.000000, 0.000000],
  [2.397467, 0.001763, 0.000000, 0.000000],
  [2.397467, 0.001681, 0.000000, 0.000000],
  [2.397468, 0.001602, 0.000000, 0.000000],
  [2.397468, 0.001527, 0.000000, 0.000000],
  [2.397468, 0.001456, 0.000000, 0.000000],
  [2.397468, 0.001388, 0.000000, 0.000000],
  [2.397468, 0.001323, 0.000000, 0.000000],
  [2.397468, 0.001261, 0.000000, 0.000000],
  [2.397468, 0.001202, 0.000000, 0.000000],
  [2.397468, 0.001146, 0.000000, 0.000000],
  [2.397468, 0.001093, 0.000000, 0.000000],
  [2.397468, 0.001042, 0.000000, 0.000000],
  [2.397468, 0.000993, 0.000000, 0.000000],
  [2.397468, 0.000947, 0.000000, 0.000000],
  [2.397468, 0.000902, 0.000000, 0.000000],
  [2.397468, 0.000860, 0.000000, 0.000000],
  [2.397468, 0.000820, 0.000000, 0.000000],
  [2.397469, 0.000782, 0.000000, 0.000000],
  [2.397469, 0.000745, 0.000000, 0.000000],
  [2.397469, 0.000710, 0.000000, 0.000000],
  [2.397469, 0.000677, 0.000000, 0.000000],
  [2.397469, 0.000646, 0.000000, 0.000000],
  [2.397469, 0.000616, 0.000000, 0.000000],
  [2.397469, 0.000587, 0.000000, 0.000000],
  [2.397469, 0.000559, 0.000000, 0.000000],
  [2.397469, 0.000533, 0.000000, 0.000000],
  [2.397469, 0.000508, 0.000000, 0.000000],
  [2.397469, 0.000485, 0.000000, 0.000000],
  [2.397469, 0.000462, 0.000000, 0.000000],
  [2.397469, 0.000440, 0.000000, 0.000000],
  [2.397469, 0.000420, 0.000000, 0.000000],
  [2.397469, 0.000400, 0.000000, 0.000000],
  [2.397469, 0.000381, 0.000000, 0.000000],
  [2.397469, 0.000364, 0.000000, 0.000000],
  [2.397469, 0.000347, 0.000000, 0.000000],
  [2.397469, 0.000330, 0.000000, 0.000000],
  [2.397469, 0.000315, 0.000000, 0.000000],
  [2.397469, 0.000300, 0.000000, 0.000000],
  [2.397469, 0.000286, 0.000000, 0.000000],
  [2.397469, 0.000273, 0.000000, 0.000000],
  [2.397469, 0.000260, 0.000000, 0.000000],
  [2.397469, 0.000248, 0.000000, 0.000000],
  [2.397469, 0.000236, 0.000000, 0.000000],
  [2.397469, 0.000225, 0.000000, 0.000000],
  [2.397469, 0.000215, 0.000000, 0.000000],
  [2.397469, 0.000205, 0.000000, 0.000000],
  [2.397469, 0.000195, 0.000000, 0.000000],
  [2.397469, 0.000186, 0.000000, 0.000000],
  [2.397469, 0.000177, 0.000000, 0.000000],
  [2.397469, 0.000169, 0.000000, 0.000000],
  [2.397469, 0.000161, 0.000000, 0.000000],
  [2.397469, 0.000154, 0.000000, 0.000000],
  [2.397469, 0.000147, 0.000000, 0.000000],
  [2.397469, 0.000140, 0.000000, 0.000000],
  [2.397469, 0.000133, 0.000000, 0.000000],
  [2.397469, 0.000127, 0.000000, 0.000000],
  [2.397469, 0.000121, 0.000000, 0.000000],
  [2.397469, 0.000115, 0.000000, 0.000000],
  [2.397469, 0.000110, 0.000000, 0.000000],
  [2.397469, 0.000105, 0.000000, 0.000000],
  [2.397469, 0.000100, 0.000000, 0.000000],
  [2.397469, 0.000095, 0.000000, 0.000000],
  [2.397469, 0.000091, 0.000000, 0.000000],
  [2.397469, 0.000087, 0.000000, 0.000000],
  [2.397469, 0.000083, 0.000000, 0.000000],
  [2.397469, 0.000079, 0.000000, 0.000000],
  [2.397469, 0.000075, 0.000000, 0.000000],
  [2.397469, 0.000071, 0.000000, 0.000000],
  [2.397469, 0.000068, 0.000000, 0.000000],
  [2.397469, 0.000065, 0.000000, 0.000000],
  [2.397469, 0.000062, 0.000000, 0.000000],
  [2.397469, 0.000059, 0.000000, 0.000000],
  [2.397469, 0.000056, 0.000000, 0.000000],
  [2.397469, 0.000054, 0.000000, 0.000000],
  [2.397469, 0.000051, 0.000000, 0.000000],
  [2.397469, 0.000049, 0.000000, 0.000000],
  [2.397469, 0.000046, 0.000000, 0.000000],
  [2.397469, 0.000044, 0.000000, 0.000000],
  [2.397469, 0.000042, 0.000000, 0.000000],
  [2.397469, 0.000040, 0.000000, 0.000000],
  [2.397469, 0.000038, 0.000000, 0.000000],
  [2.397469, 0.000037, 0.000000, 0.000000],
  [2.397469, 0.000035, 0.000000, 0.000000],
  [2.397469, 0.000033, 0.000000, 0.000000],
  [2.397469, 0.000032, 0.000000, 0.000000],
  [2.397469, 0.000030, 0.000000, 0.000000],
  [2.397469, 0.000029, 0.000000, 0.000000],
  [2.397469, 0.000027, 0.000000, 0.000000],
  [2.397469, 0.000026, 0.000000, 0.000000],
  [2.397469, 0.000025, 0.000000, 0.000000],
  [2.397469, 0.000024, 0.000000, 0.000000],
  [2.397469, 0.000023, 0.000000, 0.000000],
  [2.397469, 0.000022, 0.000000, 0.000000],
  [2.397469, 0.000021, 0.000000, 0.000000],
  [2.397469, 0.000020, 0.000000, 0.000000],
  [2.397469, 0.000019, 0.000000, 0.000000],
  [2.397469, 0.000018, 0.000000, 0.000000],
  [2.397469, 0.000017, 0.000000, 0.000000],
  [2.397469, 0.000016, 0.000000, 0.000000],
  [2.397469, 0.000015, 0.000000, 0.000000],
  [2.397469, 0.000015, 0.000000, 0.000000],
  [2.397469, 0.000014, 0.000000, 0.000000],
  [2.397469, 0.000013, 0.000000, 0.000000],
  [2.397469, 0.000013, 0.000000, 0.000000],
  [2.397469, 0.000012, 0.000000, 0.000000],
  [2.397469, 0.000012, 0.000000, 0.000000],
  [2.397469, 0.000011, 0.000000, 0.000000],
  [2.397469, 0.000011, 0.000000, 0.000000],
  [2.397469, 0.000010, 0.000000, 0.000000],
  [2.397469, 0.000010, 0.000000, 0.000000],
  [2.397469, 0.000009, 0.000000, 0.000000],
  [2.397469, 0.000009, 0.000000, 0.000000],
  [2.397469, 0.000008, 0.000000, 0.000000],
  [2.397469, 0.000008, 0.000000, 0.000000],
  [2.397469, 0.000008, 0.000000, 0.000000],
  [2.397469, 0.000007, 0.000000, 0.000000],
  [2.397469, 0.000007, 0.000000, 0.000000],
  [2.397469, 0.000007, 0.000000, 0.000000],
  [2.397469, 0.000006, 0.000000, 0.000000],
  [2.397469, 0.000006, 0.000000, 0.000000],
  [2.397469, 0.000006, 0.000000, 0.000000],
  [2.397469, 0.000005, 0.000000, 0.000000],
  [2.397469, 0.000005, 0.000000, 0.000000],
  [2.397469, 0.000005, 0.000000, 0.000000],
  [2.397469, 0.000005, 0.000000, 0.000000],
  [2.397469, 0.000004, 0.000000, 0.000000],
  [2.397469, 0.000004, 0.000000, 0.000000],
  [2.397469, 0.000004, 0.000000, 0.000000],
  [2.397469, 0.000004, 0.000000, 0.000000],
  [2.397469, 0.000004, 0.000000, 0.000000],
  [2.397469, 0.000004, 0.000000, 0.000000],
  [2.397469, 0.000003, 0.000000, 0.000000],
  [2.397469, 0.000003, 0.000000, 0.000000],
  [2.397469, 0.000003, 0.000000, 0.000000],
  [2.397469, 0.000003, 0.000000, 0.000000],
  [2.397469, 0.000003, 0.000000, 0.000000],
  [2.397469, 0.000003, 0.000000, 0.000000],
  [2.397469, 0.000003, 0.000000, 0.000000],
  [2.397469, 0.000002, 0.000000, 0.000000],
  [2.397469, 0.000002, 0.000000, 0.000000],
  [2.397469, 0.000002, 0.000000, 0.000000],
  [2.397469, 0.000002, 0.000000, 0.000000],
  [2.397469, 0.000002, 0.000000, 0.000000],
  [2.397469, 0.000002, 0.000000, 0.000000],
  [2.397469, 0.000002, 0.000000, 0.000000],
  [2.397469, 0.000002, 0.000000, 0.000000],
  [2.397469, 0.000002, 0.000000, 0.000000],
  [2.397469, 0.000002, 0.000000, 0.000000],
  [2.397469, 0.000001, 0.000000, 0.000000],
  [2.397469, 0.000001, 0.000000, 0.000000],
  [2.397469, 0.000001, 0.000000, 0.000000],
];

/**
 * @license
 * Copyright 2017 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @file ResonanceAudio library common utilities, mathematical constants,
 * and default values.
 * @author Andrew Allen <bitllama@google.com>
 */



/**
 * @file utils.js
 * @description A set of defaults, constants and utility functions.
 */


/**
 * Default input gain (linear).
 * @type {Number}
 */
const DEFAULT_SOURCE_GAIN = 1;


/**
 * Maximum outside-the-room distance to attenuate far-field listener by.
 * @type {Number}
 */
const LISTENER_MAX_OUTSIDE_ROOM_DISTANCE = 1;


/**
 * Maximum outside-the-room distance to attenuate far-field sources by.
 * @type {Number}
 */
const SOURCE_MAX_OUTSIDE_ROOM_DISTANCE = 1;


/** @type {Float32Array} */
const DEFAULT_POSITION = [0, 0, 0];


/** @type {Float32Array} */
const DEFAULT_FORWARD = [0, 0, -1];


/** @type {Float32Array} */
const DEFAULT_UP = [0, 1, 0];


/**
 * @type {Number}
 */
const DEFAULT_SPEED_OF_SOUND = 343;


/** Rolloff models (e.g. 'logarithmic', 'linear', or 'none').
 * @type {Array}
 */
const ATTENUATION_ROLLOFFS = ['logarithmic', 'linear', 'none'];


/** Default rolloff model ('logarithmic').
 * @type {string}
 */
const DEFAULT_ATTENUATION_ROLLOFF = 'logarithmic';

/** Default mode for rendering ambisonics.
 * @type {string}
 */
const DEFAULT_RENDERING_MODE = 'ambisonic';


/** @type {Number} */
const DEFAULT_MIN_DISTANCE = 1;


/** @type {Number} */
const DEFAULT_MAX_DISTANCE = 1000;


/**
 * The default alpha (i.e. microphone pattern).
 * @type {Number}
 */
const DEFAULT_DIRECTIVITY_ALPHA = 0;


/**
 * The default pattern sharpness (i.e. pattern exponent).
 * @type {Number}
 */
const DEFAULT_DIRECTIVITY_SHARPNESS = 1;


/**
 * Default azimuth (in degrees). Suitable range is 0 to 360.
 * @type {Number}
 */
const DEFAULT_AZIMUTH = 0;


/**
 * Default elevation (in degres).
 * Suitable range is from -90 (below) to 90 (above).
 * @type {Number}
 */
const DEFAULT_ELEVATION = 0;


/**
 * The default ambisonic order.
 * @type {Number}
 */
const DEFAULT_AMBISONIC_ORDER = 1;


/**
 * The default source width.
 * @type {Number}
 */
const DEFAULT_SOURCE_WIDTH = 0;


/**
 * The maximum delay (in seconds) of a single wall reflection.
 * @type {Number}
 */
const DEFAULT_REFLECTION_MAX_DURATION = 2;


/**
 * The -12dB cutoff frequency (in Hertz) for the lowpass filter applied to
 * all reflections.
 * @type {Number}
 */
const DEFAULT_REFLECTION_CUTOFF_FREQUENCY = 6400; // Uses -12dB cutoff.


/**
 * The default reflection coefficients (where 0 = no reflection, 1 = perfect
 * reflection, -1 = mirrored reflection (180-degrees out of phase)).
 * @type {Object}
 */
const DEFAULT_REFLECTION_COEFFICIENTS = {
    left: 0, right: 0, front: 0, back: 0, down: 0, up: 0,
};


/**
 * The minimum distance we consider the listener to be to any given wall.
 * @type {Number}
 */
const DEFAULT_REFLECTION_MIN_DISTANCE = 1;


/**
 * Default room dimensions (in meters).
 * @type {Object}
 */
const DEFAULT_ROOM_DIMENSIONS = {
    width: 0, height: 0, depth: 0,
};


/**
 * The multiplier to apply to distances from the listener to each wall.
 * @type {Number}
 */
const DEFAULT_REFLECTION_MULTIPLIER = 1;


/** The default bandwidth (in octaves) of the center frequencies.
 * @type {Number}
 */
const DEFAULT_REVERB_BANDWIDTH = 1;


/** The default multiplier applied when computing tail lengths.
 * @type {Number}
 */
const DEFAULT_REVERB_DURATION_MULTIPLIER = 1;


/**
 * The late reflections pre-delay (in milliseconds).
 * @type {Number}
 */
const DEFAULT_REVERB_PREDELAY = 1.5;


/**
 * The length of the beginning of the impulse response to apply a
 * half-Hann window to.
 * @type {Number}
 */
const DEFAULT_REVERB_TAIL_ONSET = 3.8;


/**
 * The default gain (linear).
 * @type {Number}
 */
const DEFAULT_REVERB_GAIN = 0.01;


/**
 * The maximum impulse response length (in seconds).
 * @type {Number}
 */
const DEFAULT_REVERB_MAX_DURATION = 3;


/**
 * Center frequencies of the multiband late reflections.
 * Nine bands are computed by: 31.25 * 2^(0:8).
 * @type {Array}
 */
const DEFAULT_REVERB_FREQUENCY_BANDS = [
    31.25, 62.5, 125, 250, 500, 1000, 2000, 4000, 8000,
];


/**
 * The number of frequency bands.
 */
const NUMBER_REVERB_FREQUENCY_BANDS =
    DEFAULT_REVERB_FREQUENCY_BANDS.length;


/**
 * The default multiband RT60 durations (in seconds).
 * @type {Float32Array}
 */
const DEFAULT_REVERB_DURATIONS =
    new Float32Array(NUMBER_REVERB_FREQUENCY_BANDS);


/**
 * Pre-defined frequency-dependent absorption coefficients for listed materials.
 * Currently supported materials are:
 * <ul>
 * <li>'transparent'</li>
 * <li>'acoustic-ceiling-tiles'</li>
 * <li>'brick-bare'</li>
 * <li>'brick-painted'</li>
 * <li>'concrete-block-coarse'</li>
 * <li>'concrete-block-painted'</li>
 * <li>'curtain-heavy'</li>
 * <li>'fiber-glass-insulation'</li>
 * <li>'glass-thin'</li>
 * <li>'glass-thick'</li>
 * <li>'grass'</li>
 * <li>'linoleum-on-concrete'</li>
 * <li>'marble'</li>
 * <li>'metal'</li>
 * <li>'parquet-on-concrete'</li>
 * <li>'plaster-smooth'</li>
 * <li>'plywood-panel'</li>
 * <li>'polished-concrete-or-tile'</li>
 * <li>'sheetrock'</li>
 * <li>'water-or-ice-surface'</li>
 * <li>'wood-ceiling'</li>
 * <li>'wood-panel'</li>
 * <li>'uniform'</li>
 * </ul>
 * @type {Object}
 */
const ROOM_MATERIAL_COEFFICIENTS = {
    'transparent':
        [1.000, 1.000, 1.000, 1.000, 1.000, 1.000, 1.000, 1.000, 1.000],
    'acoustic-ceiling-tiles':
        [0.672, 0.675, 0.700, 0.660, 0.720, 0.920, 0.880, 0.750, 1.000],
    'brick-bare':
        [0.030, 0.030, 0.030, 0.030, 0.030, 0.040, 0.050, 0.070, 0.140],
    'brick-painted':
        [0.006, 0.007, 0.010, 0.010, 0.020, 0.020, 0.020, 0.030, 0.060],
    'concrete-block-coarse':
        [0.360, 0.360, 0.360, 0.440, 0.310, 0.290, 0.390, 0.250, 0.500],
    'concrete-block-painted':
        [0.092, 0.090, 0.100, 0.050, 0.060, 0.070, 0.090, 0.080, 0.160],
    'curtain-heavy':
        [0.073, 0.106, 0.140, 0.350, 0.550, 0.720, 0.700, 0.650, 1.000],
    'fiber-glass-insulation':
        [0.193, 0.220, 0.220, 0.820, 0.990, 0.990, 0.990, 0.990, 1.000],
    'glass-thin':
        [0.180, 0.169, 0.180, 0.060, 0.040, 0.030, 0.020, 0.020, 0.040],
    'glass-thick':
        [0.350, 0.350, 0.350, 0.250, 0.180, 0.120, 0.070, 0.040, 0.080],
    'grass':
        [0.050, 0.050, 0.150, 0.250, 0.400, 0.550, 0.600, 0.600, 0.600],
    'linoleum-on-concrete':
        [0.020, 0.020, 0.020, 0.030, 0.030, 0.030, 0.030, 0.020, 0.040],
    'marble':
        [0.010, 0.010, 0.010, 0.010, 0.010, 0.010, 0.020, 0.020, 0.040],
    'metal':
        [0.030, 0.035, 0.040, 0.040, 0.050, 0.050, 0.050, 0.070, 0.090],
    'parquet-on-concrete':
        [0.028, 0.030, 0.040, 0.040, 0.070, 0.060, 0.060, 0.070, 0.140],
    'plaster-rough':
        [0.017, 0.018, 0.020, 0.030, 0.040, 0.050, 0.040, 0.030, 0.060],
    'plaster-smooth':
        [0.011, 0.012, 0.013, 0.015, 0.020, 0.030, 0.040, 0.050, 0.100],
    'plywood-panel':
        [0.400, 0.340, 0.280, 0.220, 0.170, 0.090, 0.100, 0.110, 0.220],
    'polished-concrete-or-tile':
        [0.008, 0.008, 0.010, 0.010, 0.015, 0.020, 0.020, 0.020, 0.040],
    'sheet-rock':
        [0.290, 0.279, 0.290, 0.100, 0.050, 0.040, 0.070, 0.090, 0.180],
    'water-or-ice-surface':
        [0.006, 0.006, 0.008, 0.008, 0.013, 0.015, 0.020, 0.025, 0.050],
    'wood-ceiling':
        [0.150, 0.147, 0.150, 0.110, 0.100, 0.070, 0.060, 0.070, 0.140],
    'wood-panel':
        [0.280, 0.280, 0.280, 0.220, 0.170, 0.090, 0.100, 0.110, 0.220],
    'uniform':
        [0.500, 0.500, 0.500, 0.500, 0.500, 0.500, 0.500, 0.500, 0.500],
};


/**
 * Default materials that use strings from
 * {@linkcode Utils.MATERIAL_COEFFICIENTS MATERIAL_COEFFICIENTS}
 * @type {Object}
 */
const DEFAULT_ROOM_MATERIALS = {
    left: 'transparent', right: 'transparent', front: 'transparent',
    back: 'transparent', down: 'transparent', up: 'transparent',
};


/**
 * The number of bands to average over when computing reflection coefficients.
 * @type {Number}
 */
const NUMBER_REFLECTION_AVERAGING_BANDS = 3;


/**
 * The starting band to average over when computing reflection coefficients.
 * @type {Number}
 */
const ROOM_STARTING_AVERAGING_BAND = 4;


/**
 * The minimum threshold for room volume.
 * Room model is disabled if volume is below this value.
 * @type {Number} */
const ROOM_MIN_VOLUME = 1e-4;


/**
 * Air absorption coefficients per frequency band.
 * @type {Float32Array}
 */
const ROOM_AIR_ABSORPTION_COEFFICIENTS =
    [0.0006, 0.0006, 0.0007, 0.0008, 0.0010, 0.0015, 0.0026, 0.0060, 0.0207];


/**
 * A scalar correction value to ensure Sabine and Eyring produce the same RT60
 * value at the cross-over threshold.
 * @type {Number}
 */
const ROOM_EYRING_CORRECTION_COEFFICIENT = 1.38;


/**
 * @type {Number}
 * @private
 */
const TWO_PI = 6.28318530717959;


/**
 * @type {Number}
 * @private
 */
const TWENTY_FOUR_LOG10 = 55.2620422318571;


/**
 * @type {Number}
 * @private
 */
const LOG1000 = 6.90775527898214;


/**
 * @type {Number}
 * @private
 */
const LOG2_DIV2 = 0.346573590279973;


/**
 * @type {Number}
 * @private
 */
const RADIANS_TO_DEGREES = 57.295779513082323;


/**
 * @type {Number}
 * @private
 */
const EPSILON_FLOAT = 1e-8;


/**
 * Properties describing the geometry of a room.
 * @typedef {Object} Utils~RoomDimensions
 * @property {Number} width (in meters).
 * @property {Number} height (in meters).
 * @property {Number} depth (in meters).
 */

/**
 * Properties describing the wall materials (from
 * {@linkcode Utils.ROOM_MATERIAL_COEFFICIENTS ROOM_MATERIAL_COEFFICIENTS})
 * of a room.
 * @typedef {Object} Utils~RoomMaterials
 * @property {String} left Left-wall material name.
 * @property {String} right Right-wall material name.
 * @property {String} front Front-wall material name.
 * @property {String} back Back-wall material name.
 * @property {String} up Up-wall material name.
 * @property {String} down Down-wall material name.
 */

/**
 * ResonanceAudio library logging function.
 * @type {Function}
 * @param {any} Message to be printed out.
 * @private
 */
const log$1 = function () {
    window.console.log.apply(window.console, [
        '%c[ResonanceAudio]%c '
        + Array.prototype.slice.call(arguments).join(' ') + ' %c(@'
        + performance.now().toFixed(2) + 'ms)',
        'background: #BBDEFB; color: #FF5722; font-weight: 700',
        'font-weight: 400',
        'color: #AAA',
    ]);
};


/**
 * Normalize a 3-d vector.
 * @param {Float32Array} v 3-element vector.
 * @return {Float32Array} 3-element vector.
 * @private
 */
const normalizeVector = function (v) {
    let n = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    if (n > EPSILON_FLOAT) {
        n = 1 / n;
        v[0] *= n;
        v[1] *= n;
        v[2] *= n;
    }
    return v;
};


/**
 * Cross-product between two 3-d vectors.
 * @param {Float32Array} a 3-element vector.
 * @param {Float32Array} b 3-element vector.
 * @return {Float32Array}
 * @private
 */
const crossProduct = function (ax, ay, az, bx, by, bz, arr) {
    arr[0] = ay * bz - az * by;
    arr[1] = az * bx - ax * bz;
    arr[2] = ax * by - ay * bx;
};

/**
 * @license
 * Copyright 2017 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */


/**
 * Spatially encodes input using weighted spherical harmonics.
 */
class Encoder {
    /**
     * Spatially encodes input using weighted spherical harmonics.
     * @param {AudioContext} context
     * Associated {@link
    https://developer.mozilla.org/en-US/docs/Web/API/AudioContext AudioContext}.
     * @param {Object} options
     * @param {Number} options.ambisonicOrder
     * Desired ambisonic order. Defaults to
     * {@linkcode Utils.DEFAULT_AMBISONIC_ORDER DEFAULT_AMBISONIC_ORDER}.
     * @param {Number} options.azimuth
     * Azimuth (in degrees). Defaults to
     * {@linkcode Utils.DEFAULT_AZIMUTH DEFAULT_AZIMUTH}.
     * @param {Number} options.elevation
     * Elevation (in degrees). Defaults to
     * {@linkcode Utils.DEFAULT_ELEVATION DEFAULT_ELEVATION}.
     * @param {Number} options.sourceWidth
     * Source width (in degrees). Where 0 degrees is a point source and 360 degrees
     * is an omnidirectional source. Defaults to
     * {@linkcode Utils.DEFAULT_SOURCE_WIDTH DEFAULT_SOURCE_WIDTH}.
     */
    constructor(context, options) {
        // Public variables.
        /**
         * Mono (1-channel) input {@link
         * https://developer.mozilla.org/en-US/docs/Web/API/AudioNode AudioNode}.
         * @member {AudioNode} input
         * @memberof Encoder
         * @instance
         */
        /**
         * Ambisonic (multichannel) output {@link
         * https://developer.mozilla.org/en-US/docs/Web/API/AudioNode AudioNode}.
         * @member {AudioNode} output
         * @memberof Encoder
         * @instance
         */

        // Use defaults for undefined arguments.
        if (options == undefined) {
            options = {};
        }
        if (options.ambisonicOrder == undefined) {
            options.ambisonicOrder = DEFAULT_AMBISONIC_ORDER;
        }
        if (options.azimuth == undefined) {
            options.azimuth = DEFAULT_AZIMUTH;
        }
        if (options.elevation == undefined) {
            options.elevation = DEFAULT_ELEVATION;
        }
        if (options.sourceWidth == undefined) {
            options.sourceWidth = DEFAULT_SOURCE_WIDTH;
        }

        this._context = context;

        // Create I/O nodes.
        this.input = context.createGain();
        this._channelGain = [];
        this._merger = undefined;
        this.output = context.createGain();

        // Set initial order, angle and source width.
        this.setAmbisonicOrder(options.ambisonicOrder);
        this._azimuth = options.azimuth;
        this._elevation = options.elevation;
        this.setSourceWidth(options.sourceWidth);
    }

    /**
     * Set the desired ambisonic order.
     * @param {Number} ambisonicOrder Desired ambisonic order.
     */
    setAmbisonicOrder(ambisonicOrder) {
        this._ambisonicOrder = Encoder.validateAmbisonicOrder(ambisonicOrder);

        this.input.disconnect();
        for (let i = 0; i < this._channelGain.length; i++) {
            this._channelGain[i].disconnect();
        }
        if (this._merger != undefined) {
            this._merger.disconnect();
        }
        delete this._channelGain;
        delete this._merger;

        // Create audio graph.
        let numChannels = (this._ambisonicOrder + 1) * (this._ambisonicOrder + 1);
        this._merger = this._context.createChannelMerger(numChannels);
        this._channelGain = new Array(numChannels);
        for (let i = 0; i < numChannels; i++) {
            this._channelGain[i] = this._context.createGain();
            this.input.connect(this._channelGain[i]);
            this._channelGain[i].connect(this._merger, 0, i);
        }
        this._merger.connect(this.output);
    }

    dispose() {
        this._merger.disconnect(this.output);
        let numChannels = (this._ambisonicOrder + 1) * (this._ambisonicOrder + 1);
        for (let i = 0; i < numChannels; ++i) {
            this._channelGain[i].disconnect(this._merger, 0, i);
            this.input.disconnect(this._channelGain[i]);
        }
    }


    /**
     * Set the direction of the encoded source signal.
     * @param {Number} azimuth
     * Azimuth (in degrees). Defaults to
     * {@linkcode Utils.DEFAULT_AZIMUTH DEFAULT_AZIMUTH}.
     * @param {Number} elevation
     * Elevation (in degrees). Defaults to
     * {@linkcode Utils.DEFAULT_ELEVATION DEFAULT_ELEVATION}.
     */
    setDirection(azimuth, elevation) {
        // Format input direction to nearest indices.
        if (azimuth == undefined || isNaN(azimuth)) {
            azimuth = DEFAULT_AZIMUTH;
        }
        if (elevation == undefined || isNaN(elevation)) {
            elevation = DEFAULT_ELEVATION;
        }

        // Store the formatted input (for updating source width).
        this._azimuth = azimuth;
        this._elevation = elevation;

        // Format direction for index lookups.
        azimuth = Math.round(azimuth % 360);
        if (azimuth < 0) {
            azimuth += 360;
        }
        elevation = Math.round(Math.min(90, Math.max(-90, elevation))) + 90;

        // Assign gains to each output.
        this._channelGain[0].gain.value = MAX_RE_WEIGHTS[this._spreadIndex][0];
        for (let i = 1; i <= this._ambisonicOrder; i++) {
            let degreeWeight = MAX_RE_WEIGHTS[this._spreadIndex][i];
            for (let j = -i; j <= i; j++) {
                let acnChannel = (i * i) + i + j;
                let elevationIndex = i * (i + 1) / 2 + Math.abs(j) - 1;
                let val = SPHERICAL_HARMONICS[1][elevation][elevationIndex];
                if (j != 0) {
                    let azimuthIndex = SPHERICAL_HARMONICS_MAX_ORDER + j - 1;
                    if (j < 0) {
                        azimuthIndex = SPHERICAL_HARMONICS_MAX_ORDER + j;
                    }
                    val *= SPHERICAL_HARMONICS[0][azimuth][azimuthIndex];
                }
                this._channelGain[acnChannel].gain.value = val * degreeWeight;
            }
        }
    }


    /**
     * Set the source width (in degrees). Where 0 degrees is a point source and 360
     * degrees is an omnidirectional source.
     * @param {Number} sourceWidth (in degrees).
     */
    setSourceWidth(sourceWidth) {
        // The MAX_RE_WEIGHTS is a 360 x (Tables.SPHERICAL_HARMONICS_MAX_ORDER+1)
        // size table.
        this._spreadIndex = Math.min(359, Math.max(0, Math.round(sourceWidth)));
        this.setDirection(this._azimuth, this._elevation);
    }
}


/**
 * Validate the provided ambisonic order.
 * @param {Number} ambisonicOrder Desired ambisonic order.
 * @return {Number} Validated/adjusted ambisonic order.
 * @private
 */
Encoder.validateAmbisonicOrder = function (ambisonicOrder) {
    if (isNaN(ambisonicOrder) || ambisonicOrder == undefined) {
        log$1('Error: Invalid ambisonic order',
            ambisonicOrder, '\nUsing ambisonicOrder=1 instead.');
        ambisonicOrder = 1;
    } else if (ambisonicOrder < 1) {
        log$1('Error: Unable to render ambisonic order',
            ambisonicOrder, '(Min order is 1)',
            '\nUsing min order instead.');
        ambisonicOrder = 1;
    } else if (ambisonicOrder > SPHERICAL_HARMONICS_MAX_ORDER) {
        log$1('Error: Unable to render ambisonic order',
            ambisonicOrder, '(Max order is',
            SPHERICAL_HARMONICS_MAX_ORDER, ')\nUsing max order instead.');
        ambisonicOrder = SPHERICAL_HARMONICS_MAX_ORDER;
    }
    return ambisonicOrder;
};

/**
 * @license
 * Copyright 2017 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */


/**
 * Listener model to spatialize sources in an environment.
 */
class Listener {
    /**
     * Listener model to spatialize sources in an environment.
     * @param {AudioContext} context
     * Associated {@link
    https://developer.mozilla.org/en-US/docs/Web/API/AudioContext AudioContext}.
     * @param {Object} options
     * @param {Number} options.ambisonicOrder
     * Desired ambisonic order. Defaults to
     * {@linkcode Utils.DEFAULT_AMBISONIC_ORDER DEFAULT_AMBISONIC_ORDER}.
     * @param {Float32Array} options.position
     * Initial position (in meters), where origin is the center of
     * the room. Defaults to
     * {@linkcode Utils.DEFAULT_POSITION DEFAULT_POSITION}.
     * @param {Float32Array} options.forward
     * The listener's initial forward vector. Defaults to
     * {@linkcode Utils.DEFAULT_FORWARD DEFAULT_FORWARD}.
     * @param {Float32Array} options.up
     * The listener's initial up vector. Defaults to
     * {@linkcode Utils.DEFAULT_UP DEFAULT_UP}.
     */
    constructor(context, options) {
        // Public variables.
        /**
         * Position (in meters).
         * @member {Float32Array} position
         * @memberof Listener
         * @instance
         */
        /**
         * Ambisonic (multichannel) input {@link
         * https://developer.mozilla.org/en-US/docs/Web/API/AudioNode AudioNode}.
         * @member {AudioNode} input
         * @memberof Listener
         * @instance
         */
        /**
         * Binaurally-rendered stereo (2-channel) output {@link
         * https://developer.mozilla.org/en-US/docs/Web/API/AudioNode AudioNode}.
         * @member {AudioNode} output
         * @memberof Listener
         * @instance
         */
        /**
         * Ambisonic (multichannel) output {@link
         * https://developer.mozilla.org/en-US/docs/Web/API/AudioNode AudioNode}.
         * @member {AudioNode} ambisonicOutput
         * @memberof Listener
         * @instance
         */
        // Use defaults for undefined arguments.
        if (options == undefined) {
            options = {};
        }
        if (options.ambisonicOrder == undefined) {
            options.ambisonicOrder = DEFAULT_AMBISONIC_ORDER;
        }
        if (options.position == undefined) {
            options.position = DEFAULT_POSITION.slice();
        }
        if (options.forward == undefined) {
            options.forward = DEFAULT_FORWARD.slice();
        }
        if (options.up == undefined) {
            options.up = DEFAULT_UP.slice();
        }
        if (options.renderingMode == undefined) {
            options.renderingMode = DEFAULT_RENDERING_MODE;
        }

        // Member variables.
        this.position = new Float32Array(3);
        this._tempMatrix3 = new Float32Array(9);

        // Select the appropriate HRIR filters using 2-channel chunks since
        // multichannel audio is not yet supported by a majority of browsers.
        this._ambisonicOrder =
            Encoder.validateAmbisonicOrder(options.ambisonicOrder);

        // Create audio nodes.
        this._context = context;
        if (this._ambisonicOrder == 1) {
            this._renderer = createFOARenderer(context, {
                renderingMode: options.renderingMode
            });
        } else if (this._ambisonicOrder > 1) {
            this._renderer = createHOARenderer(context, {
                ambisonicOrder: this._ambisonicOrder,
                renderingMode: options.renderingMode
            });
        }

        // These nodes are created in order to safely asynchronously load Omnitone
        // while the rest of the scene is being created.
        this.input = context.createGain();
        this.output = context.createGain();
        this.ambisonicOutput = context.createGain();

        // Initialize Omnitone (async) and connect to audio graph when complete.
        this._renderer.initialize().then(() => {
            // Connect pre-rotated soundfield to renderer.
            this.input.connect(this._renderer.input);

            // Connect rotated soundfield to ambisonic output.
            if (this._ambisonicOrder > 1) {
                this._renderer._hoaRotator.output.connect(this.ambisonicOutput);
            } else {
                this._renderer._foaRotator.output.connect(this.ambisonicOutput);
            }

            // Connect binaurally-rendered soundfield to binaural output.
            this._renderer.output.connect(this.output);
        });

        // Set orientation and update rotation matrix accordingly.
        this.setOrientation(
            options.forward[0], options.forward[1], options.forward[2],
            options.up[0], options.up[1], options.up[2]);
    }

    getRenderingMode() {
        return this._renderer.getRenderingMode();
    }

    /** @type {String} */
    setRenderingMode(mode) {
        this._renderer.setRenderingMode(mode);
    }

    dispose() {
        // Connect pre-rotated soundfield to renderer.
        this.input.disconnect(this._renderer.input);

        // Connect rotated soundfield to ambisonic output.
        if (this._ambisonicOrder > 1) {
            this._renderer._hoaRotator.output.disconnect(this.ambisonicOutput);
        } else {
            this._renderer._foaRotator.output.disconnect(this.ambisonicOutput);
        }

        // Connect binaurally-rendered soundfield to binaural output.
        this._renderer.output.disconnect(this.output);

        this._renderer.dispose();
    }


    /**
     * Set the source's orientation using forward and up vectors.
     * @param {Number} forwardX
     * @param {Number} forwardY
     * @param {Number} forwardZ
     * @param {Number} upX
     * @param {Number} upY
     * @param {Number} upZ
     */
    setOrientation(forwardX, forwardY, forwardZ,
        upX, upY, upZ) {
        crossProduct(
            forwardX, forwardY, forwardZ,
            upX, upY, upZ,
            this._tempMatrix3);
        this._tempMatrix3[3] = upX;
        this._tempMatrix3[4] = upY;
        this._tempMatrix3[5] = upZ;
        this._tempMatrix3[6] = -forwardX;
        this._tempMatrix3[7] = -forwardY;
        this._tempMatrix3[8] = -forwardZ;
        this._renderer.setRotationMatrix3(this._tempMatrix3);
    }
}

/**
 * @license
 * Copyright 2017 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Directivity/occlusion filter.
 **/
class Directivity {
    /**
     * Directivity/occlusion filter.
     * @param {AudioContext} context
     * Associated {@link
    https://developer.mozilla.org/en-US/docs/Web/API/AudioContext AudioContext}.
     * @param {Object} options
     * @param {Number} options.alpha
     * Determines directivity pattern (0 to 1). See
     * {@link Directivity#setPattern setPattern} for more details. Defaults to
     * {@linkcode Utils.DEFAULT_DIRECTIVITY_ALPHA DEFAULT_DIRECTIVITY_ALPHA}.
     * @param {Number} options.sharpness
     * Determines the sharpness of the directivity pattern (1 to Inf). See
     * {@link Directivity#setPattern setPattern} for more details. Defaults to
     * {@linkcode Utils.DEFAULT_DIRECTIVITY_SHARPNESS
     * DEFAULT_DIRECTIVITY_SHARPNESS}.
     */
    constructor(context, options) {
        // Public variables.
        /**
         * Mono (1-channel) input {@link
         * https://developer.mozilla.org/en-US/docs/Web/API/AudioNode AudioNode}.
         * @member {AudioNode} input
         * @memberof Directivity
         * @instance
         */
        /**
         * Mono (1-channel) output {@link
         * https://developer.mozilla.org/en-US/docs/Web/API/AudioNode AudioNode}.
         * @member {AudioNode} output
         * @memberof Directivity
         * @instance
         */

        // Use defaults for undefined arguments.
        if (options == undefined) {
            options = {};
        }
        if (options.alpha == undefined) {
            options.alpha = DEFAULT_DIRECTIVITY_ALPHA;
        }
        if (options.sharpness == undefined) {
            options.sharpness = DEFAULT_DIRECTIVITY_SHARPNESS;
        }

        // Create audio node.
        this._context = context;
        this._lowpass = context.createBiquadFilter();

        // Initialize filter coefficients.
        this._lowpass.type = 'lowpass';
        this._lowpass.Q.value = 0;
        this._lowpass.frequency.value = context.sampleRate * 0.5;

        this._cosTheta = 0;
        this.setPattern(options.alpha, options.sharpness);

        // Input/Output proxy.
        this.input = this._lowpass;
        this.output = this._lowpass;
    }


    /**
     * Compute the filter using the source's forward orientation and the listener's
     * position.
     * @param {Float32Array} forward The source's forward vector.
     * @param {Float32Array} direction The direction from the source to the
     * listener.
     */
    computeAngle(forward, direction) {
        let forwardNorm = normalizeVector(forward);
        let directionNorm = normalizeVector(direction);
        let coeff = 1;
        if (this._alpha > EPSILON_FLOAT) {
            let cosTheta = forwardNorm[0] * directionNorm[0] +
                forwardNorm[1] * directionNorm[1] + forwardNorm[2] * directionNorm[2];
            coeff = (1 - this._alpha) + this._alpha * cosTheta;
            coeff = Math.pow(Math.abs(coeff), this._sharpness);
        }
        this._lowpass.frequency.value = this._context.sampleRate * 0.5 * coeff;
    }


    /**
     * Set source's directivity pattern (defined by alpha), where 0 is an
     * omnidirectional pattern, 1 is a bidirectional pattern, 0.5 is a cardiod
     * pattern. The sharpness of the pattern is increased exponenentially.
     * @param {Number} alpha
     * Determines directivity pattern (0 to 1).
     * @param {Number} sharpness
     * Determines the sharpness of the directivity pattern (1 to Inf).
     * DEFAULT_DIRECTIVITY_SHARPNESS}.
     */
    setPattern(alpha, sharpness) {
        // Clamp and set values.
        this._alpha = Math.min(1, Math.max(0, alpha));
        this._sharpness = Math.max(1, sharpness);

        // Update angle calculation using new values.
        this.computeAngle([this._cosTheta * this._cosTheta, 0, 0], [1, 0, 0]);
    }
}

/**
 * @license
 * Copyright 2017 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */


/**
 * Distance-based attenuation filter.
 */
class Attenuation {
    /**
     * Distance-based attenuation filter.
     * @param {AudioContext} context
     * Associated {@link
    https://developer.mozilla.org/en-US/docs/Web/API/AudioContext AudioContext}.
     * @param {Object} options
     * @param {Number} options.minDistance
     * Min. distance (in meters). Defaults to
     * {@linkcode Utils.DEFAULT_MIN_DISTANCE DEFAULT_MIN_DISTANCE}.
     * @param {Number} options.maxDistance
     * Max. distance (in meters). Defaults to
     * {@linkcode Utils.DEFAULT_MAX_DISTANCE DEFAULT_MAX_DISTANCE}.
     * @param {string} options.rolloff
     * Rolloff model to use, chosen from options in
     * {@linkcode Utils.ATTENUATION_ROLLOFFS ATTENUATION_ROLLOFFS}. Defaults to
     * {@linkcode Utils.DEFAULT_ATTENUATION_ROLLOFF DEFAULT_ATTENUATION_ROLLOFF}.
     */
    constructor(context, options) {
        // Public variables.
        /**
         * Min. distance (in meters).
         * @member {Number} minDistance
         * @memberof Attenuation
         * @instance
         */
        /**
         * Max. distance (in meters).
         * @member {Number} maxDistance
         * @memberof Attenuation
         * @instance
         */
        /**
         * Mono (1-channel) input {@link
         * https://developer.mozilla.org/en-US/docs/Web/API/AudioNode AudioNode}.
         * @member {AudioNode} input
         * @memberof Attenuation
         * @instance
         */
        /**
         * Mono (1-channel) output {@link
         * https://developer.mozilla.org/en-US/docs/Web/API/AudioNode AudioNode}.
         * @member {AudioNode} output
         * @memberof Attenuation
         * @instance
         */

        // Use defaults for undefined arguments.
        if (options == undefined) {
            options = {};
        }
        if (options.minDistance == undefined) {
            options.minDistance = DEFAULT_MIN_DISTANCE;
        }
        if (options.maxDistance == undefined) {
            options.maxDistance = DEFAULT_MAX_DISTANCE;
        }
        if (options.rolloff == undefined) {
            options.rolloff = DEFAULT_ATTENUATION_ROLLOFF;
        }

        // Assign values.
        this.minDistance = options.minDistance;
        this.maxDistance = options.maxDistance;
        this.setRolloff(options.rolloff);

        // Create node.
        this._gainNode = context.createGain();

        // Initialize distance to max distance.
        this.setDistance(options.maxDistance);

        // Input/Output proxy.
        this.input = this._gainNode;
        this.output = this._gainNode;
    }

    /**
     * Set distance from the listener.
     * @param {Number} distance Distance (in meters).
     */
    setDistance(distance) {
        let gain = 1;
        if (this._rolloff == 'logarithmic') {
            if (distance > this.maxDistance) {
                gain = 0;
            } else if (distance > this.minDistance) {
                let range = this.maxDistance - this.minDistance;
                if (range > EPSILON_FLOAT) {
                    // Compute the distance attenuation value by the logarithmic curve
                    // "1 / (d + 1)" with an offset of |minDistance|.
                    let relativeDistance = distance - this.minDistance;
                    let attenuation = 1 / (relativeDistance + 1);
                    let attenuationMax = 1 / (range + 1);
                    gain = (attenuation - attenuationMax) / (1 - attenuationMax);
                }
            }
        } else if (this._rolloff == 'linear') {
            if (distance > this.maxDistance) {
                gain = 0;
            } else if (distance > this.minDistance) {
                let range = this.maxDistance - this.minDistance;
                if (range > EPSILON_FLOAT) {
                    gain = (this.maxDistance - distance) / range;
                }
            }
        }
        this._gainNode.gain.value = gain;
    }


    /**
     * Set rolloff.
     * @param {string} rolloff
     * Rolloff model to use, chosen from options in
     * {@linkcode Utils.ATTENUATION_ROLLOFFS ATTENUATION_ROLLOFFS}.
     */
    setRolloff(rolloff) {
        let isValidModel = ~ATTENUATION_ROLLOFFS.indexOf(rolloff);
        if (rolloff == undefined || !isValidModel) {
            if (!isValidModel) {
                log$1('Invalid rolloff model (\"' + rolloff +
                    '\"). Using default: \"' + DEFAULT_ATTENUATION_ROLLOFF + '\".');
            }
            rolloff = DEFAULT_ATTENUATION_ROLLOFF;
        } else {
            rolloff = rolloff.toString().toLowerCase();
        }
        this._rolloff = rolloff;
    }
}

/**
 * @license
 * Copyright 2017 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */


/**
 * Options for constructing a new Source.
 * @typedef {Object} Source~SourceOptions
 * @property {Float32Array} position
 * The source's initial position (in meters), where origin is the center of
 * the room. Defaults to {@linkcode Utils.DEFAULT_POSITION DEFAULT_POSITION}.
 * @property {Float32Array} forward
 * The source's initial forward vector. Defaults to
 * {@linkcode Utils.DEFAULT_FORWARD DEFAULT_FORWARD}.
 * @property {Float32Array} up
 * The source's initial up vector. Defaults to
 * {@linkcode Utils.DEFAULT_UP DEFAULT_UP}.
 * @property {Number} minDistance
 * Min. distance (in meters). Defaults to
 * {@linkcode Utils.DEFAULT_MIN_DISTANCE DEFAULT_MIN_DISTANCE}.
 * @property {Number} maxDistance
 * Max. distance (in meters). Defaults to
 * {@linkcode Utils.DEFAULT_MAX_DISTANCE DEFAULT_MAX_DISTANCE}.
 * @property {string} rolloff
 * Rolloff model to use, chosen from options in
 * {@linkcode Utils.ATTENUATION_ROLLOFFS ATTENUATION_ROLLOFFS}. Defaults to
 * {@linkcode Utils.DEFAULT_ATTENUATION_ROLLOFF DEFAULT_ATTENUATION_ROLLOFF}.
 * @property {Number} gain Input gain (linear). Defaults to
 * {@linkcode Utils.DEFAULT_SOURCE_GAIN DEFAULT_SOURCE_GAIN}.
 * @property {Number} alpha Directivity alpha. Defaults to
 * {@linkcode Utils.DEFAULT_DIRECTIVITY_ALPHA DEFAULT_DIRECTIVITY_ALPHA}.
 * @property {Number} sharpness Directivity sharpness. Defaults to
 * {@linkcode Utils.DEFAULT_DIRECTIVITY_SHARPNESS
 * DEFAULT_DIRECTIVITY_SHARPNESS}.
 * @property {Number} sourceWidth
 * Source width (in degrees). Where 0 degrees is a point source and 360 degrees
 * is an omnidirectional source. Defaults to
 * {@linkcode Utils.DEFAULT_SOURCE_WIDTH DEFAULT_SOURCE_WIDTH}.
 */


/**
 * Determine the distance a source is outside of a room. Attenuate gain going
 * to the reflections and reverb when the source is outside of the room.
 * @param {Number} distance Distance in meters.
 * @return {Number} Gain (linear) of source.
 * @private
 */
function _computeDistanceOutsideRoom(distance) {
    // We apply a linear ramp from 1 to 0 as the source is up to 1m outside.
    let gain = 1;
    if (distance > EPSILON_FLOAT) {
        gain = 1 - distance / SOURCE_MAX_OUTSIDE_ROOM_DISTANCE;

        // Clamp gain between 0 and 1.
        gain = Math.max(0, Math.min(1, gain));
    }
    return gain;
}

/**
 * Source model to spatialize an audio buffer.
 */
class Source {
    /**
     * Source model to spatialize an audio buffer.
     * @param {ResonanceAudio} scene Associated ResonanceAudio instance.
     * @param {Source~SourceOptions} options
     * Options for constructing a new Source.
     */
    constructor(scene, options) {
        // Public variables.
        /**
         * Mono (1-channel) input {@link
         * https://developer.mozilla.org/en-US/docs/Web/API/AudioNode AudioNode}.
         * @member {AudioNode} input
         * @memberof Source
         * @instance
         */
        /**
         *
         */

        // Use defaults for undefined arguments.
        if (options == undefined) {
            options = {};
        }
        if (options.position == undefined) {
            options.position = DEFAULT_POSITION.slice();
        }
        if (options.forward == undefined) {
            options.forward = DEFAULT_FORWARD.slice();
        }
        if (options.up == undefined) {
            options.up = DEFAULT_UP.slice();
        }
        if (options.minDistance == undefined) {
            options.minDistance = DEFAULT_MIN_DISTANCE;
        }
        if (options.maxDistance == undefined) {
            options.maxDistance = DEFAULT_MAX_DISTANCE;
        }
        if (options.rolloff == undefined) {
            options.rolloff = DEFAULT_ATTENUATION_ROLLOFF;
        }
        if (options.gain == undefined) {
            options.gain = DEFAULT_SOURCE_GAIN;
        }
        if (options.alpha == undefined) {
            options.alpha = DEFAULT_DIRECTIVITY_ALPHA;
        }
        if (options.sharpness == undefined) {
            options.sharpness = DEFAULT_DIRECTIVITY_SHARPNESS;
        }
        if (options.sourceWidth == undefined) {
            options.sourceWidth = DEFAULT_SOURCE_WIDTH;
        }

        // Member variables.
        this._scene = scene;
        this._position = options.position;
        this._forward = options.forward;
        this._up = options.up;
        this._dx = new Float32Array(3);
        this._right = [];
        crossProduct(
            this._forward[0], this._forward[1], this._forward[2],
            this._up[0], this._up[1], this._up[2],
            this._right);

        // Create audio nodes.
        let context = scene._context;
        this.input = context.createGain();
        this._directivity = new Directivity(context, {
            alpha: options.alpha,
            sharpness: options.sharpness,
        });
        this._toEarly = context.createGain();
        this._toLate = context.createGain();
        this._attenuation = new Attenuation(context, {
            minDistance: options.minDistance,
            maxDistance: options.maxDistance,
            rolloff: options.rolloff,
        });
        this._encoder = new Encoder(context, {
            ambisonicOrder: scene._ambisonicOrder,
            sourceWidth: options.sourceWidth,
        });

        // Connect nodes.
        this.input.connect(this._toLate);
        this._toLate.connect(scene._room.late.input);

        this.input.connect(this._attenuation.input);
        this._attenuation.output.connect(this._toEarly);
        this._toEarly.connect(scene._room.early.input);

        this._attenuation.output.connect(this._directivity.input);
        this._directivity.output.connect(this._encoder.input);

        this._encoder.output.connect(scene._listener.input);

        // Assign initial conditions.
        this.setPosition(
            options.position[0], options.position[1], options.position[2]);
        this.input.gain.value = options.gain;
    }

    dispose() {
        this._encoder.output.disconnect(this._scene._listener.input);
        this._directivity.output.disconnect(this._encoder.input);
        this._attenuation.output.disconnect(this._directivity.input);
        this._toEarly.disconnect(this._scene._room.early.input);
        this._attenuation.output.disconnect(this._toEarly);
        this.input.disconnect(this._attenuation.input);
        this._toLate.disconnect(this._scene._room.late.input);
        this.input.disconnect(this._toLate);

        this._encoder.dispose();
    }


    /**
     * Set source's position (in meters), where origin is the center of
     * the room.
     * @param {Number} x
     * @param {Number} y
     * @param {Number} z
     */
    setPosition(x, y, z) {
        // Assign new position.
        this._position[0] = x;
        this._position[1] = y;
        this._position[2] = z;

        // Handle far-field effect.
        let distance = this._scene._room.getDistanceOutsideRoom(
            this._position[0], this._position[1], this._position[2]);
        let gain = _computeDistanceOutsideRoom(distance);
        this._toLate.gain.value = gain;
        this._toEarly.gain.value = gain;

        this._update();
    }


    // Update the source when changing the listener's position.
    _update() {
        // Compute distance to listener.
        for (let i = 0; i < 3; i++) {
            this._dx[i] = this._position[i] - this._scene._listener.position[i];
        }
        let distance = Math.sqrt(this._dx[0] * this._dx[0] +
            this._dx[1] * this._dx[1] + this._dx[2] * this._dx[2]);
        if (distance > 0) {
            // Normalize direction vector.
            this._dx[0] /= distance;
            this._dx[1] /= distance;
            this._dx[2] /= distance;
        }

        // Compuete angle of direction vector.
        let azimuth = Math.atan2(-this._dx[0], this._dx[2]) *
            RADIANS_TO_DEGREES;
        let elevation = Math.atan2(this._dx[1], Math.sqrt(this._dx[0] * this._dx[0] +
            this._dx[2] * this._dx[2])) * RADIANS_TO_DEGREES;

        // Set distance/directivity/direction values.
        this._attenuation.setDistance(distance);
        this._directivity.computeAngle(this._forward, this._dx);
        this._encoder.setDirection(azimuth, elevation);
    }


    /**
     * Set source's rolloff.
     * @param {string} rolloff
     * Rolloff model to use, chosen from options in
     * {@linkcode Utils.ATTENUATION_ROLLOFFS ATTENUATION_ROLLOFFS}.
     */
    setRolloff(rolloff) {
        this._attenuation.setRolloff(rolloff);
    }


    /**
     * Set source's minimum distance (in meters).
     * @param {Number} minDistance
     */
    setMinDistance(minDistance) {
        this._attenuation.minDistance = minDistance;
    }


    /**
     * Set source's maximum distance (in meters).
     * @param {Number} maxDistance
     */
    setMaxDistance(maxDistance) {
        this._attenuation.maxDistance = maxDistance;
    }


    /**
     * Set source's gain (linear).
     * @param {Number} gain
     */
    setGain(gain) {
        this.input.gain.value = gain;
    }


    /**
     * Set the source's orientation using forward and up vectors.
     * @param {Number} forwardX
     * @param {Number} forwardY
     * @param {Number} forwardZ
     * @param {Number} upX
     * @param {Number} upY
     * @param {Number} upZ
     */
    setOrientation(forwardX, forwardY, forwardZ,
        upX, upY, upZ) {
        this._forward[0] = forwardX;
        this._forward[1] = forwardY;
        this._forward[2] = forwardZ;
        this._up[0] = upX;
        this._up[1] = upY;
        this._up[2] = upZ;
        crossProduct(
            forwardX, forwardY, forwardZ,
            upX, upY, upZ,
            this._right);
    }


    /**
     * Set the source width (in degrees). Where 0 degrees is a point source and 360
     * degrees is an omnidirectional source.
     * @param {Number} sourceWidth (in degrees).
     */
    setSourceWidth(sourceWidth) {
        this._encoder.setSourceWidth(sourceWidth);
        this.setPosition(this._position[0], this._position[1], this._position[2]);
    }


    /**
     * Set source's directivity pattern (defined by alpha), where 0 is an
     * omnidirectional pattern, 1 is a bidirectional pattern, 0.5 is a cardiod
     * pattern. The sharpness of the pattern is increased exponentially.
     * @param {Number} alpha
     * Determines directivity pattern (0 to 1).
     * @param {Number} sharpness
     * Determines the sharpness of the directivity pattern (1 to Inf).
     */
    setDirectivityPattern(alpha, sharpness) {
        this._directivity.setPattern(alpha, sharpness);
        this.setPosition(this._position[0], this._position[1], this._position[2]);
    }
}

/**
 * @license
 * Copyright 2017 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */


/**
 * Late-reflections reverberation filter for Ambisonic content.
 */
class LateReflections {
    /**
    * Late-reflections reverberation filter for Ambisonic content.
    * @param {AudioContext} context
    * Associated {@link
    https://developer.mozilla.org/en-US/docs/Web/API/AudioContext AudioContext}.
    * @param {Object} options
    * @param {Array} options.durations
    * Multiband RT60 durations (in seconds) for each frequency band, listed as
    * {@linkcode Utils.DEFAULT_REVERB_FREQUENCY_BANDS
    * FREQUDEFAULT_REVERB_FREQUENCY_BANDSENCY_BANDS}. Defaults to
    * {@linkcode Utils.DEFAULT_REVERB_DURATIONS DEFAULT_REVERB_DURATIONS}.
    * @param {Number} options.predelay Pre-delay (in milliseconds). Defaults to
    * {@linkcode Utils.DEFAULT_REVERB_PREDELAY DEFAULT_REVERB_PREDELAY}.
    * @param {Number} options.gain Output gain (linear). Defaults to
    * {@linkcode Utils.DEFAULT_REVERB_GAIN DEFAULT_REVERB_GAIN}.
    * @param {Number} options.bandwidth Bandwidth (in octaves) for each frequency
    * band. Defaults to
    * {@linkcode Utils.DEFAULT_REVERB_BANDWIDTH DEFAULT_REVERB_BANDWIDTH}.
    * @param {Number} options.tailonset Length (in milliseconds) of impulse
    * response to apply a half-Hann window. Defaults to
    * {@linkcode Utils.DEFAULT_REVERB_TAIL_ONSET DEFAULT_REVERB_TAIL_ONSET}.
    */
    constructor(context, options) {
        // Public variables.
        /**
         * Mono (1-channel) input {@link
         * https://developer.mozilla.org/en-US/docs/Web/API/AudioNode AudioNode}.
         * @member {AudioNode} input
         * @memberof LateReflections
         * @instance
         */
        /**
         * Mono (1-channel) output {@link
         * https://developer.mozilla.org/en-US/docs/Web/API/AudioNode AudioNode}.
         * @member {AudioNode} output
         * @memberof LateReflections
         * @instance
         */

        // Use defaults for undefined arguments.
        if (options == undefined) {
            options = {};
        }
        if (options.durations == undefined) {
            options.durations = DEFAULT_REVERB_DURATIONS.slice();
        }
        if (options.predelay == undefined) {
            options.predelay = DEFAULT_REVERB_PREDELAY;
        }
        if (options.gain == undefined) {
            options.gain = DEFAULT_REVERB_GAIN;
        }
        if (options.bandwidth == undefined) {
            options.bandwidth = DEFAULT_REVERB_BANDWIDTH;
        }
        if (options.tailonset == undefined) {
            options.tailonset = DEFAULT_REVERB_TAIL_ONSET;
        }

        // Assign pre-computed variables.
        let delaySecs = options.predelay / 1000;
        this._bandwidthCoeff = options.bandwidth * LOG2_DIV2;
        this._tailonsetSamples = options.tailonset / 1000;

        // Create nodes.
        this._context = context;
        this.input = context.createGain();
        this._predelay = context.createDelay(delaySecs);
        this._convolver = context.createConvolver();
        this.output = context.createGain();

        // Set reverb attenuation.
        this.output.gain.value = options.gain;

        // Disable normalization.
        this._convolver.normalize = false;

        // Connect nodes.
        this.input.connect(this._predelay);
        this._predelay.connect(this._convolver);
        this._convolver.connect(this.output);

        // Compute IR using RT60 values.
        this.setDurations(options.durations);
    }

    dispose() {
        this.input.disconnect(this._predelay);
        this._predelay.disconnect(this._convolver);
        this._convolver.disconnect(this.output);
    }


    /**
     * Re-compute a new impulse response by providing Multiband RT60 durations.
     * @param {Array} durations
     * Multiband RT60 durations (in seconds) for each frequency band, listed as
     * {@linkcode Utils.DEFAULT_REVERB_FREQUENCY_BANDS
     * DEFAULT_REVERB_FREQUENCY_BANDS}.
     */
    setDurations(durations) {
        if (durations.length !== NUMBER_REVERB_FREQUENCY_BANDS) {
            log$1('Warning: invalid number of RT60 values provided to reverb.');
            return;
        }

        // Compute impulse response.
        let durationsSamples =
            new Float32Array(NUMBER_REVERB_FREQUENCY_BANDS);
        let sampleRate = this._context.sampleRate;

        for (let i = 0; i < durations.length; i++) {
            // Clamp within suitable range.
            durations[i] =
                Math.max(0, Math.min(DEFAULT_REVERB_MAX_DURATION, durations[i]));

            // Convert seconds to samples.
            durationsSamples[i] = Math.round(durations[i] * sampleRate *
                DEFAULT_REVERB_DURATION_MULTIPLIER);
        }
        // Determine max RT60 length in samples.
        let durationsSamplesMax = 0;
        for (let i = 0; i < durationsSamples.length; i++) {
            if (durationsSamples[i] > durationsSamplesMax) {
                durationsSamplesMax = durationsSamples[i];
            }
        }

        // Skip this step if there is no reverberation to compute.
        if (durationsSamplesMax < 1) {
            durationsSamplesMax = 1;
        }

        // Create impulse response buffer.
        let buffer = this._context.createBuffer(1, durationsSamplesMax, sampleRate);
        let bufferData = buffer.getChannelData(0);

        // Create noise signal (computed once, referenced in each band's routine).
        let noiseSignal = new Float32Array(durationsSamplesMax);
        for (let i = 0; i < durationsSamplesMax; i++) {
            noiseSignal[i] = Math.random() * 2 - 1;
        }

        // Compute the decay rate per-band and filter the decaying noise signal.
        for (let i = 0; i < NUMBER_REVERB_FREQUENCY_BANDS; i++) {
            // Compute decay rate.
            let decayRate = -LOG1000 / durationsSamples[i];

            // Construct a standard one-zero, two-pole bandpass filter:
            // H(z) = (b0 * z^0 + b1 * z^-1 + b2 * z^-2) / (1 + a1 * z^-1 + a2 * z^-2)
            let omega = TWO_PI *
                DEFAULT_REVERB_FREQUENCY_BANDS[i] / sampleRate;
            let sinOmega = Math.sin(omega);
            let alpha = sinOmega * Math.sinh(this._bandwidthCoeff * omega / sinOmega);
            let a0CoeffReciprocal = 1 / (1 + alpha);
            let b0Coeff = alpha * a0CoeffReciprocal;
            let a1Coeff = -2 * Math.cos(omega) * a0CoeffReciprocal;
            let a2Coeff = (1 - alpha) * a0CoeffReciprocal;

            // We optimize since b2 = -b0, b1 = 0.
            // Update equation for two-pole bandpass filter:
            //   u[n] = x[n] - a1 * x[n-1] - a2 * x[n-2]
            //   y[n] = b0 * (u[n] - u[n-2])
            let um1 = 0;
            let um2 = 0;
            for (let j = 0; j < durationsSamples[i]; j++) {
                // Exponentially-decaying white noise.
                let x = noiseSignal[j] * Math.exp(decayRate * j);

                // Filter signal with bandpass filter and add to output.
                let u = x - a1Coeff * um1 - a2Coeff * um2;
                bufferData[j] += b0Coeff * (u - um2);

                // Update coefficients.
                um2 = um1;
                um1 = u;
            }
        }

        // Create and apply half of a Hann window to the beginning of the
        // impulse response.
        let halfHannLength =
            Math.round(this._tailonsetSamples);
        for (let i = 0; i < Math.min(bufferData.length, halfHannLength); i++) {
            let halfHann =
                0.5 * (1 - Math.cos(TWO_PI * i / (2 * halfHannLength - 1)));
            bufferData[i] *= halfHann;
        }
        this._convolver.buffer = buffer;
    }
}

/**
 * @license
 * Copyright 2017 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
* Ray-tracing-based early reflections model.
*/
class EarlyReflections {

    /**
     * Ray-tracing-based early reflections model.
     * @param {AudioContext} context
     * Associated {@link
    https://developer.mozilla.org/en-US/docs/Web/API/AudioContext AudioContext}.
     * @param {Object} options
     * @param {Utils~RoomDimensions} options.dimensions
     * Room dimensions (in meters). Defaults to
     * {@linkcode Utils.DEFAULT_ROOM_DIMENSIONS DEFAULT_ROOM_DIMENSIONS}.
     * @param {Object} options.coefficients
     * Frequency-independent reflection coeffs per wall. Defaults to
     * {@linkcode Utils.DEFAULT_REFLECTION_COEFFICIENTS
     * DEFAULT_REFLECTION_COEFFICIENTS}.
     * @param {Number} options.speedOfSound
     * (in meters / second). Defaults to {@linkcode Utils.DEFAULT_SPEED_OF_SOUND
     * DEFAULT_SPEED_OF_SOUND}.
     * @param {Float32Array} options.listenerPosition
     * (in meters). Defaults to
     * {@linkcode Utils.DEFAULT_POSITION DEFAULT_POSITION}.
     */
    constructor(context, options) {
        // Public variables.
        /**
         * The room's speed of sound (in meters/second).
         * @member {Number} speedOfSound
         * @memberof EarlyReflections
         * @instance
         */
        /**
         * Mono (1-channel) input {@link
         * https://developer.mozilla.org/en-US/docs/Web/API/AudioNode AudioNode}.
         * @member {AudioNode} input
         * @memberof EarlyReflections
         * @instance
         */
        /**
         * First-order ambisonic (4-channel) output {@link
         * https://developer.mozilla.org/en-US/docs/Web/API/AudioNode AudioNode}.
         * @member {AudioNode} output
         * @memberof EarlyReflections
         * @instance
         */

        // Use defaults for undefined arguments.
        if (options == undefined) {
            options = {};
        }
        if (options.speedOfSound == undefined) {
            options.speedOfSound = DEFAULT_SPEED_OF_SOUND;
        }
        if (options.listenerPosition == undefined) {
            options.listenerPosition = DEFAULT_POSITION.slice();
        }
        if (options.coefficients == undefined) {
            options.coefficients = {};
            Object.assign(options.coefficients, DEFAULT_REFLECTION_COEFFICIENTS);
        }

        // Assign room's speed of sound.
        this.speedOfSound = options.speedOfSound;

        // Create nodes.
        this.input = context.createGain();
        this.output = context.createGain();
        this._lowpass = context.createBiquadFilter();
        this._delays = {};
        this._gains = {}; // gainPerWall = (ReflectionCoeff / Attenuation)
        this._inverters = {}; // 3 of these are needed for right/back/down walls.
        this._merger = context.createChannelMerger(4); // First-order encoding only.

        // Connect audio graph for each wall reflection.
        for (let property in DEFAULT_REFLECTION_COEFFICIENTS) {
            if (DEFAULT_REFLECTION_COEFFICIENTS
                .hasOwnProperty(property)) {
                this._delays[property] =
                    context.createDelay(DEFAULT_REFLECTION_MAX_DURATION);
                this._gains[property] = context.createGain();
            }
        }
        this._inverters.right = context.createGain();
        this._inverters.down = context.createGain();
        this._inverters.back = context.createGain();

        // Initialize lowpass filter.
        this._lowpass.type = 'lowpass';
        this._lowpass.frequency.value = DEFAULT_REFLECTION_CUTOFF_FREQUENCY;
        this._lowpass.Q.value = 0;

        // Initialize encoder directions, set delay times and gains to 0.
        for (let property in DEFAULT_REFLECTION_COEFFICIENTS) {
            if (DEFAULT_REFLECTION_COEFFICIENTS
                .hasOwnProperty(property)) {
                this._delays[property].delayTime.value = 0;
                this._gains[property].gain.value = 0;
            }
        }

        // Initialize inverters for opposite walls ('right', 'down', 'back' only).
        this._inverters.right.gain.value = -1;
        this._inverters.down.gain.value = -1;
        this._inverters.back.gain.value = -1;

        // Connect nodes.
        this.input.connect(this._lowpass);
        for (let property in DEFAULT_REFLECTION_COEFFICIENTS) {
            if (DEFAULT_REFLECTION_COEFFICIENTS
                .hasOwnProperty(property)) {
                this._lowpass.connect(this._delays[property]);
                this._delays[property].connect(this._gains[property]);
                this._gains[property].connect(this._merger, 0, 0);
            }
        }

        // Connect gains to ambisonic channel output.
        // Left: [1 1 0 0]
        // Right: [1 -1 0 0]
        // Up: [1 0 1 0]
        // Down: [1 0 -1 0]
        // Front: [1 0 0 1]
        // Back: [1 0 0 -1]
        this._gains.left.connect(this._merger, 0, 1);

        this._gains.right.connect(this._inverters.right);
        this._inverters.right.connect(this._merger, 0, 1);

        this._gains.up.connect(this._merger, 0, 2);

        this._gains.down.connect(this._inverters.down);
        this._inverters.down.connect(this._merger, 0, 2);

        this._gains.front.connect(this._merger, 0, 3);

        this._gains.back.connect(this._inverters.back);
        this._inverters.back.connect(this._merger, 0, 3);
        this._merger.connect(this.output);

        // Initialize.
        this._listenerPosition = options.listenerPosition;
        this.setRoomProperties(options.dimensions, options.coefficients);
    }

    dipose() {
        // Connect nodes.
        this.input.disconnect(this._lowpass);
        for (let property in DEFAULT_REFLECTION_COEFFICIENTS) {
            if (DEFAULT_REFLECTION_COEFFICIENTS
                .hasOwnProperty(property)) {
                this._lowpass.disconnect(this._delays[property]);
                this._delays[property].disconnect(this._gains[property]);
                this._gains[property].disconnect(this._merger, 0, 0);
            }
        }

        // Connect gains to ambisonic channel output.
        // Left: [1 1 0 0]
        // Right: [1 -1 0 0]
        // Up: [1 0 1 0]
        // Down: [1 0 -1 0]
        // Front: [1 0 0 1]
        // Back: [1 0 0 -1]
        this._gains.left.disconnect(this._merger, 0, 1);

        this._gains.right.disconnect(this._inverters.right);
        this._inverters.right.disconnect(this._merger, 0, 1);

        this._gains.up.disconnect(this._merger, 0, 2);

        this._gains.down.disconnect(this._inverters.down);
        this._inverters.down.disconnect(this._merger, 0, 2);

        this._gains.front.disconnect(this._merger, 0, 3);

        this._gains.back.disconnect(this._inverters.back);
        this._inverters.back.disconnect(this._merger, 0, 3);
        this._merger.disconnect(this.output);
    }


    /**
     * Set the listener's position (in meters),
     * where [0,0,0] is the center of the room.
     * @param {Number} x
     * @param {Number} y
     * @param {Number} z
     */
    setListenerPosition(x, y, z) {
        // Assign listener position.
        this._listenerPosition = [x, y, z];

        // Determine distances to each wall.
        let distances = {
            left: DEFAULT_REFLECTION_MULTIPLIER * Math.max(0,
                this._halfDimensions.width + x) + DEFAULT_REFLECTION_MIN_DISTANCE,
            right: DEFAULT_REFLECTION_MULTIPLIER * Math.max(0,
                this._halfDimensions.width - x) + DEFAULT_REFLECTION_MIN_DISTANCE,
            front: DEFAULT_REFLECTION_MULTIPLIER * Math.max(0,
                this._halfDimensions.depth + z) + DEFAULT_REFLECTION_MIN_DISTANCE,
            back: DEFAULT_REFLECTION_MULTIPLIER * Math.max(0,
                this._halfDimensions.depth - z) + DEFAULT_REFLECTION_MIN_DISTANCE,
            down: DEFAULT_REFLECTION_MULTIPLIER * Math.max(0,
                this._halfDimensions.height + y) + DEFAULT_REFLECTION_MIN_DISTANCE,
            up: DEFAULT_REFLECTION_MULTIPLIER * Math.max(0,
                this._halfDimensions.height - y) + DEFAULT_REFLECTION_MIN_DISTANCE,
        };

        // Assign delay & attenuation values using distances.
        for (let property in DEFAULT_REFLECTION_COEFFICIENTS) {
            if (DEFAULT_REFLECTION_COEFFICIENTS
                .hasOwnProperty(property)) {
                // Compute and assign delay (in seconds).
                let delayInSecs = distances[property] / this.speedOfSound;
                this._delays[property].delayTime.value = delayInSecs;

                // Compute and assign gain, uses logarithmic rolloff: "g = R / (d + 1)"
                let attenuation = this._coefficients[property] / distances[property];
                this._gains[property].gain.value = attenuation;
            }
        }
    }


    /**
     * Set the room's properties which determines the characteristics of
     * reflections.
     * @param {Utils~RoomDimensions} dimensions
     * Room dimensions (in meters). Defaults to
     * {@linkcode Utils.DEFAULT_ROOM_DIMENSIONS DEFAULT_ROOM_DIMENSIONS}.
     * @param {Object} coefficients
     * Frequency-independent reflection coeffs per wall. Defaults to
     * {@linkcode Utils.DEFAULT_REFLECTION_COEFFICIENTS
     * DEFAULT_REFLECTION_COEFFICIENTS}.
     */
    setRoomProperties(dimensions, coefficients) {
        if (dimensions == undefined) {
            dimensions = {};
            Object.assign(dimensions, DEFAULT_ROOM_DIMENSIONS);
        }
        if (coefficients == undefined) {
            coefficients = {};
            Object.assign(coefficients, DEFAULT_REFLECTION_COEFFICIENTS);
        }
        this._coefficients = coefficients;

        // Sanitize dimensions and store half-dimensions.
        this._halfDimensions = {};
        this._halfDimensions.width = dimensions.width * 0.5;
        this._halfDimensions.height = dimensions.height * 0.5;
        this._halfDimensions.depth = dimensions.depth * 0.5;

        // Update listener position with new room properties.
        this.setListenerPosition(this._listenerPosition[0],
            this._listenerPosition[1], this._listenerPosition[2]);
    }
}

/**
 * @license
 * Copyright 2017 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */


/**
 * Generate absorption coefficients from material names.
 * @param {Object} materials
 * @return {Object}
 */
function _getCoefficientsFromMaterials(materials) {
    // Initialize coefficients to use defaults.
    let coefficients = {};
    for (let property in DEFAULT_ROOM_MATERIALS) {
        if (DEFAULT_ROOM_MATERIALS.hasOwnProperty(property)) {
            coefficients[property] = ROOM_MATERIAL_COEFFICIENTS[
                DEFAULT_ROOM_MATERIALS[property]];
        }
    }

    // Sanitize materials.
    if (materials == undefined) {
        materials = {};
        Object.assign(materials, DEFAULT_ROOM_MATERIALS);
    }

    // Assign coefficients using provided materials.
    for (let property in DEFAULT_ROOM_MATERIALS) {
        if (DEFAULT_ROOM_MATERIALS.hasOwnProperty(property) &&
            materials.hasOwnProperty(property)) {
            if (materials[property] in ROOM_MATERIAL_COEFFICIENTS) {
                coefficients[property] =
                    ROOM_MATERIAL_COEFFICIENTS[materials[property]];
            } else {
                log$1('Material \"' + materials[property] + '\" on wall \"' +
                    property + '\" not found. Using \"' +
                    DEFAULT_ROOM_MATERIALS[property] + '\".');
            }
        } else {
            log$1('Wall \"' + property + '\" is not defined. Default used.');
        }
    }
    return coefficients;
}

/**
 * Sanitize coefficients.
 * @param {Object} coefficients
 * @return {Object}
 */
function _sanitizeCoefficients(coefficients) {
    if (coefficients == undefined) {
        coefficients = {};
    }
    for (let property in DEFAULT_ROOM_MATERIALS) {
        if (!(coefficients.hasOwnProperty(property))) {
            // If element is not present, use default coefficients.
            coefficients[property] = ROOM_MATERIAL_COEFFICIENTS[
                DEFAULT_ROOM_MATERIALS[property]];
        }
    }
    return coefficients;
}

/**
 * Sanitize dimensions.
 * @param {Utils~RoomDimensions} dimensions
 * @return {Utils~RoomDimensions}
 */
function _sanitizeDimensions(dimensions) {
    if (dimensions == undefined) {
        dimensions = {};
    }
    for (let property in DEFAULT_ROOM_DIMENSIONS) {
        if (!(dimensions.hasOwnProperty(property))) {
            dimensions[property] = DEFAULT_ROOM_DIMENSIONS[property];
        }
    }
    return dimensions;
}

/**
 * Compute frequency-dependent reverb durations.
 * @param {Utils~RoomDimensions} dimensions
 * @param {Object} coefficients
 * @param {Number} speedOfSound
 * @return {Array}
 */
function _getDurationsFromProperties(dimensions, coefficients, speedOfSound) {
    let durations = new Float32Array(NUMBER_REVERB_FREQUENCY_BANDS);

    // Sanitize inputs.
    dimensions = _sanitizeDimensions(dimensions);
    coefficients = _sanitizeCoefficients(coefficients);
    if (speedOfSound == undefined) {
        speedOfSound = DEFAULT_SPEED_OF_SOUND;
    }

    // Acoustic constant.
    let k = TWENTY_FOUR_LOG10 / speedOfSound;

    // Compute volume, skip if room is not present.
    let volume = dimensions.width * dimensions.height * dimensions.depth;
    if (volume < ROOM_MIN_VOLUME) {
        return durations;
    }

    // Room surface area.
    let leftRightArea = dimensions.width * dimensions.height;
    let floorCeilingArea = dimensions.width * dimensions.depth;
    let frontBackArea = dimensions.depth * dimensions.height;
    let totalArea = 2 * (leftRightArea + floorCeilingArea + frontBackArea);
    for (let i = 0; i < NUMBER_REVERB_FREQUENCY_BANDS; i++) {
        // Effective absorptive area.
        let absorbtionArea =
            (coefficients.left[i] + coefficients.right[i]) * leftRightArea +
            (coefficients.down[i] + coefficients.up[i]) * floorCeilingArea +
            (coefficients.front[i] + coefficients.back[i]) * frontBackArea;
        let meanAbsorbtionArea = absorbtionArea / totalArea;

        // Compute reverberation using Eyring equation [1].
        // [1] Beranek, Leo L. "Analysis of Sabine and Eyring equations and their
        //     application to concert hall audience and chair absorption." The
        //     Journal of the Acoustical Society of America, Vol. 120, No. 3.
        //     (2006), pp. 1399-1399.
        durations[i] = ROOM_EYRING_CORRECTION_COEFFICIENT * k * volume /
            (-totalArea * Math.log(1 - meanAbsorbtionArea) + 4 *
                ROOM_AIR_ABSORPTION_COEFFICIENTS[i] * volume);
    }
    return durations;
}


/**
 * Compute reflection coefficients from absorption coefficients.
 * @param {Object} absorptionCoefficients
 * @return {Object}
 */
function _computeReflectionCoefficients(absorptionCoefficients) {
    let reflectionCoefficients = [];
    for (let property in DEFAULT_REFLECTION_COEFFICIENTS) {
        if (DEFAULT_REFLECTION_COEFFICIENTS
            .hasOwnProperty(property)) {
            // Compute average absorption coefficient (per wall).
            reflectionCoefficients[property] = 0;
            for (let j = 0; j < NUMBER_REFLECTION_AVERAGING_BANDS; j++) {
                let bandIndex = j + ROOM_STARTING_AVERAGING_BAND;
                reflectionCoefficients[property] +=
                    absorptionCoefficients[property][bandIndex];
            }
            reflectionCoefficients[property] /=
                NUMBER_REFLECTION_AVERAGING_BANDS;

            // Convert absorption coefficient to reflection coefficient.
            reflectionCoefficients[property] =
                Math.sqrt(1 - reflectionCoefficients[property]);
        }
    }
    return reflectionCoefficients;
}


/**
 * @class Room
 * @description Model that manages early and late reflections using acoustic
 * properties and listener position relative to a rectangular room.
 * @param {AudioContext} context
 * Associated {@link
https://developer.mozilla.org/en-US/docs/Web/API/AudioContext AudioContext}.
 * @param {Object} options
 * @param {Float32Array} options.listenerPosition
 * The listener's initial position (in meters), where origin is the center of
 * the room. Defaults to {@linkcode Utils.DEFAULT_POSITION DEFAULT_POSITION}.
 * @param {Utils~RoomDimensions} options.dimensions Room dimensions (in meters). Defaults to
 * {@linkcode Utils.DEFAULT_ROOM_DIMENSIONS DEFAULT_ROOM_DIMENSIONS}.
 * @param {Utils~RoomMaterials} options.materials Named acoustic materials per wall.
 * Defaults to {@linkcode Utils.DEFAULT_ROOM_MATERIALS DEFAULT_ROOM_MATERIALS}.
 * @param {Number} options.speedOfSound
 * (in meters/second). Defaults to
 * {@linkcode Utils.DEFAULT_SPEED_OF_SOUND DEFAULT_SPEED_OF_SOUND}.
 */
class Room {
    constructor(context, options) {
        // Public variables.
        /**
         * EarlyReflections {@link EarlyReflections EarlyReflections} submodule.
         * @member {AudioNode} early
         * @memberof Room
         * @instance
         */
        /**
         * LateReflections {@link LateReflections LateReflections} submodule.
         * @member {AudioNode} late
         * @memberof Room
         * @instance
         */
        /**
         * Ambisonic (multichannel) output {@link
         * https://developer.mozilla.org/en-US/docs/Web/API/AudioNode AudioNode}.
         * @member {AudioNode} output
         * @memberof Room
         * @instance
         */

        // Use defaults for undefined arguments.
        if (options == undefined) {
            options = {};
        }
        if (options.listenerPosition == undefined) {
            options.listenerPosition = DEFAULT_POSITION.slice();
        }
        if (options.dimensions == undefined) {
            options.dimensions = {};
            Object.assign(options.dimensions, DEFAULT_ROOM_DIMENSIONS);
        }
        if (options.materials == undefined) {
            options.materials = {};
            Object.assign(options.materials, DEFAULT_ROOM_MATERIALS);
        }
        if (options.speedOfSound == undefined) {
            options.speedOfSound = DEFAULT_SPEED_OF_SOUND;
        }

        // Sanitize room-properties-related arguments.
        options.dimensions = _sanitizeDimensions(options.dimensions);
        let absorptionCoefficients = _getCoefficientsFromMaterials(options.materials);
        let reflectionCoefficients =
            _computeReflectionCoefficients(absorptionCoefficients);
        let durations = _getDurationsFromProperties(options.dimensions,
            absorptionCoefficients, options.speedOfSound);

        // Construct submodules for early and late reflections.
        this.early = new EarlyReflections(context, {
            dimensions: options.dimensions,
            coefficients: reflectionCoefficients,
            speedOfSound: options.speedOfSound,
            listenerPosition: options.listenerPosition,
        });
        this.late = new LateReflections(context, {
            durations: durations,
        });

        this.speedOfSound = options.speedOfSound;

        // Construct auxillary audio nodes.
        this.output = context.createGain();
        this.early.output.connect(this.output);
        this._merger = context.createChannelMerger(4);

        this.late.output.connect(this._merger, 0, 0);
        this._merger.connect(this.output);
    }

    dispose() {
        this.early.output.disconnect(this.output);
        this.late.output.disconnect(this._merger, 0, 0);
        this._merger.disconnect(this.output);
    }


    /**
     * Set the room's dimensions and wall materials.
     * @param {Utils~RoomDimensions} dimensions Room dimensions (in meters). Defaults to
     * {@linkcode Utils.DEFAULT_ROOM_DIMENSIONS DEFAULT_ROOM_DIMENSIONS}.
     * @param {Utils~RoomMaterials} materials Named acoustic materials per wall. Defaults to
     * {@linkcode Utils.DEFAULT_ROOM_MATERIALS DEFAULT_ROOM_MATERIALS}.
     */
    setProperties(dimensions, materials) {
        // Compute late response.
        let absorptionCoefficients = _getCoefficientsFromMaterials(materials);
        let durations = _getDurationsFromProperties(dimensions,
            absorptionCoefficients, this.speedOfSound);
        this.late.setDurations(durations);

        // Compute early response.
        this.early.speedOfSound = this.speedOfSound;
        let reflectionCoefficients =
            _computeReflectionCoefficients(absorptionCoefficients);
        this.early.setRoomProperties(dimensions, reflectionCoefficients);
    }


    /**
     * Set the listener's position (in meters), where origin is the center of
     * the room.
     * @param {Number} x
     * @param {Number} y
     * @param {Number} z
     */
    setListenerPosition(x, y, z) {
        this.early.speedOfSound = this.speedOfSound;
        this.early.setListenerPosition(x, y, z);

        // Disable room effects if the listener is outside the room boundaries.
        let distance = this.getDistanceOutsideRoom(x, y, z);
        let gain = 1;
        if (distance > EPSILON_FLOAT) {
            gain = 1 - distance / LISTENER_MAX_OUTSIDE_ROOM_DISTANCE;

            // Clamp gain between 0 and 1.
            gain = Math.max(0, Math.min(1, gain));
        }
        this.output.gain.value = gain;
    }


    /**
     * Compute distance outside room of provided position (in meters).
     * @param {Number} x
     * @param {Number} y
     * @param {Number} z
     * @return {Number}
     * Distance outside room (in meters). Returns 0 if inside room.
     */
    getDistanceOutsideRoom(x, y, z) {
        let dx = Math.max(0, -this.early._halfDimensions.width - x,
            x - this.early._halfDimensions.width);
        let dy = Math.max(0, -this.early._halfDimensions.height - y,
            y - this.early._halfDimensions.height);
        let dz = Math.max(0, -this.early._halfDimensions.depth - z,
            z - this.early._halfDimensions.depth);
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
}

/**
 * Copyright 2017 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @file ResonanceAudio version.
 * @author Andrew Allen <bitllama@google.com>
 */

/**
 * ResonanceAudio library version
 * @type {String}
 */
var Version$1 = '2.0.0';

/**
 * @license
 * Copyright 2017 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */


/**
 * Options for constructing a new ResonanceAudio scene.
 * @typedef {Object} ResonanceAudio~ResonanceAudioOptions
 * @property {Number} ambisonicOrder
 * Desired ambisonic Order. Defaults to
 * {@linkcode Utils.DEFAULT_AMBISONIC_ORDER DEFAULT_AMBISONIC_ORDER}.
 * @property {Float32Array} listenerPosition
 * The listener's initial position (in meters), where origin is the center of
 * the room. Defaults to {@linkcode Utils.DEFAULT_POSITION DEFAULT_POSITION}.
 * @property {Float32Array} listenerForward
 * The listener's initial forward vector.
 * Defaults to {@linkcode Utils.DEFAULT_FORWARD DEFAULT_FORWARD}.
 * @property {Float32Array} listenerUp
 * The listener's initial up vector.
 * Defaults to {@linkcode Utils.DEFAULT_UP DEFAULT_UP}.
 * @property {Utils~RoomDimensions} dimensions Room dimensions (in meters). Defaults to
 * {@linkcode Utils.DEFAULT_ROOM_DIMENSIONS DEFAULT_ROOM_DIMENSIONS}.
 * @property {Utils~RoomMaterials} materials Named acoustic materials per wall.
 * Defaults to {@linkcode Utils.DEFAULT_ROOM_MATERIALS DEFAULT_ROOM_MATERIALS}.
 * @property {Number} speedOfSound
 * (in meters/second). Defaults to
 * {@linkcode Utils.DEFAULT_SPEED_OF_SOUND DEFAULT_SPEED_OF_SOUND}.
 */


/**
 * Main class for managing sources, room and listener models.
 */
class ResonanceAudio {
    /**
     * Main class for managing sources, room and listener models.
     * @param {AudioContext} context
     * Associated {@link
    https://developer.mozilla.org/en-US/docs/Web/API/AudioContext AudioContext}.
     * @param {ResonanceAudio~ResonanceAudioOptions} options
     * Options for constructing a new ResonanceAudio scene.
     */
    constructor(context, options) {
        // Public variables.
        /**
         * Binaurally-rendered stereo (2-channel) output {@link
         * https://developer.mozilla.org/en-US/docs/Web/API/AudioNode AudioNode}.
         * @member {AudioNode} output
         * @memberof ResonanceAudio
         * @instance
         */
        /**
         * Ambisonic (multichannel) input {@link
         * https://developer.mozilla.org/en-US/docs/Web/API/AudioNode AudioNode}
         * (For rendering input soundfields).
         * @member {AudioNode} ambisonicInput
         * @memberof ResonanceAudio
         * @instance
         */
        /**
         * Ambisonic (multichannel) output {@link
         * https://developer.mozilla.org/en-US/docs/Web/API/AudioNode AudioNode}
         * (For allowing external rendering / post-processing).
         * @member {AudioNode} ambisonicOutput
         * @memberof ResonanceAudio
         * @instance
         */

        // Use defaults for undefined arguments.
        if (options == undefined) {
            options = {};
        }
        if (options.ambisonicOrder == undefined) {
            options.ambisonicOrder = DEFAULT_AMBISONIC_ORDER;
        }
        if (options.listenerPosition == undefined) {
            options.listenerPosition = DEFAULT_POSITION.slice();
        }
        if (options.listenerForward == undefined) {
            options.listenerForward = DEFAULT_FORWARD.slice();
        }
        if (options.listenerUp == undefined) {
            options.listenerUp = DEFAULT_UP.slice();
        }
        if (options.dimensions == undefined) {
            options.dimensions = {};
            Object.assign(options.dimensions, DEFAULT_ROOM_DIMENSIONS);
        }
        if (options.materials == undefined) {
            options.materials = {};
            Object.assign(options.materials, DEFAULT_ROOM_MATERIALS);
        }
        if (options.speedOfSound == undefined) {
            options.speedOfSound = DEFAULT_SPEED_OF_SOUND;
        }
        if (options.renderingMode == undefined) {
            options.renderingMode = DEFAULT_RENDERING_MODE;
        }

        // Create member submodules.
        this._ambisonicOrder = Encoder.validateAmbisonicOrder(options.ambisonicOrder);

        /** @type {Source[]} */
        this._sources = [];
        this._room = new Room(context, {
            listenerPosition: options.listenerPosition,
            dimensions: options.dimensions,
            materials: options.materials,
            speedOfSound: options.speedOfSound,
        });
        this._listener = new Listener(context, {
            ambisonicOrder: options.ambisonicOrder,
            position: options.listenerPosition,
            forward: options.listenerForward,
            up: options.listenerUp,
            renderingMode: options.renderingMode
        });

        // Create auxillary audio nodes.
        this._context = context;
        this.output = context.createGain();
        this.ambisonicOutput = context.createGain();
        this.ambisonicInput = this._listener.input;

        // Connect audio graph.
        this._room.output.connect(this._listener.input);
        this._listener.output.connect(this.output);
        this._listener.ambisonicOutput.connect(this.ambisonicOutput);
    }

    getRenderingMode() {
        return this._listener.getRenderingMode();
    }

    /** @type {String} */
    setRenderingMode(mode) {
        this._listener.setRenderingMode(mode);
    }

    dispose() {
        this._room.output.disconnect(this._listener.input);
        this._listener.output.disconnect(this.output);
        this._listener.ambisonicOutput.disconnect(this.ambisonicOutput);
    }


    /**
     * Create a new source for the scene.
     * @param {Source~SourceOptions} options
     * Options for constructing a new Source.
     * @return {Source}
     */
    createSource(options) {
        // Create a source and push it to the internal sources array, returning
        // the object's reference to the user.
        let source = new Source(this, options);
        this._sources[this._sources.length] = source;
        return source;
    }

    /**
     * Remove an existing source for the scene.
     * @param {Source} source
     */
    removeSource(source) {
        const sourceIdx = this._sources.findIndex((s) => s === source);
        if (sourceIdx > -1) {
            this._sources.splice(sourceIdx, 1);
            source.dispose();
        }
    }


    /**
     * Set the scene's desired ambisonic order.
     * @param {Number} ambisonicOrder Desired ambisonic order.
     */
    setAmbisonicOrder(ambisonicOrder) {
        this._ambisonicOrder = Encoder.validateAmbisonicOrder(ambisonicOrder);
    }


    /**
     * Set the room's dimensions and wall materials.
     * @param {Object} dimensions Room dimensions (in meters).
     * @param {Object} materials Named acoustic materials per wall.
     */
    setRoomProperties(dimensions, materials) {
        this._room.setProperties(dimensions, materials);
    }


    /**
     * Set the listener's position (in meters), where origin is the center of
     * the room.
     * @param {Number} x
     * @param {Number} y
     * @param {Number} z
     */
    setListenerPosition(x, y, z) {
        // Update listener position.
        this._listener.position[0] = x;
        this._listener.position[1] = y;
        this._listener.position[2] = z;
        this._room.setListenerPosition(x, y, z);

        // Update sources with new listener position.
        this._sources.forEach(function (element) {
            element._update();
        });
    }


    /**
     * Set the source's orientation using forward and up vectors.
     * @param {Number} forwardX
     * @param {Number} forwardY
     * @param {Number} forwardZ
     * @param {Number} upX
     * @param {Number} upY
     * @param {Number} upZ
     */
    setListenerOrientation(forwardX, forwardY,
        forwardZ, upX, upY, upZ) {
        this._listener.setOrientation(forwardX, forwardY, forwardZ, upX, upY, upZ);
    }


    /**
     * Set the listener's position and orientation using a Three.js Matrix4 object.
     * @param {Object} matrix
     * The Three.js Matrix4 object representing the listener's world transform.
     */
    setListenerFromMatrix(matrix) {
        this._listener.setFromMatrix(matrix);

        // Update the rest of the scene using new listener position.
        this.setListenerPosition(this._listener.position[0],
            this._listener.position[1], this._listener.position[2]);
    }


    /**
     * Set the speed of sound.
     * @param {Number} speedOfSound
     */
    setSpeedOfSound(speedOfSound) {
        this._room.speedOfSound = speedOfSound;
    }
}

ResonanceAudio.Version = Version$1;

/**
 * A spatializer that uses Google's Resonance Audio library.
 **/
class ResonanceSource extends BaseRoutedSource {

    /**
     * Creates a new spatializer that uses Google's Resonance Audio library.
     * @param {string} id
     * @param {MediaStream|HTMLAudioElement} stream
     * @param {AudioContext} audioContext
     * @param {import("../../../../lib/resonance-audio/src/resonance-audio").ResonanceAudio} res
     */
    constructor(id, stream, audioContext, res) {
        const resNode = res.createSource();
        super(id, stream, audioContext, resNode.input);

        this.inNode.disconnect(audioContext.destination);
        this.resScene = res;
        this.resNode = resNode;

        Object.seal(this);
    }

    /**
     * Performs the spatialization operation for the audio source's latest location.
     * @param {import("../../positions/Pose").Pose} loc
     */
    update(loc) {
        super.update(loc);
        const { p, f, u } = loc;
        this.resNode.setMinDistance(this.minDistance);
        this.resNode.setMaxDistance(this.maxDistance);
        this.resNode.setPosition(p.x, p.y, p.z);
        this.resNode.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }

    /**
     * Discard values and make this instance useless.
     */
    dispose() {
        this.resScene.removeSource(this.resNode);
        this.resNode = null;
        super.dispose();
    }
}

/**
 * An audio positioner that uses Google's Resonance Audio library
 **/
class ResonanceScene extends BaseListener {
    /**
     * Creates a new audio positioner that uses Google's Resonance Audio library
     * @param {AudioContext} audioContext
     */
    constructor(audioContext) {
        super();

        this.scene = new ResonanceAudio(audioContext, {
            ambisonicOrder: 1,
            renderingMode: "bypass"
        });
        
        this.scene.output.connect(audioContext.destination);

        this.scene.setRoomProperties({
            width: 10,
            height: 5,
            depth: 10,
        }, {
            left: "transparent",
            right: "transparent",
            front: "transparent",
            back: "transparent",
            down: "grass",
            up: "transparent",
        });

        Object.seal(this);
    }

    /**
     * Performs the spatialization operation for the audio source's latest location.
     * @param {import("../../positions/Pose").Pose} loc
     */
    update(loc) {
        super.update(loc);
        const { p, f, u } = loc;
        this.scene.setListenerPosition(p.x, p.y, p.z);
        this.scene.setListenerOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }

    /**
     * Creates a spatialzer for an audio source.
     * @private
     * @param {string} id
     * @param {MediaStream|HTMLAudioElement} stream - the audio element that is being spatialized.
     * @param {boolean} spatialize - whether or not the audio stream should be spatialized. Stereo audio streams that are spatialized will get down-mixed to a single channel.
     * @param {AudioContext} audioContext
     * @return {import("../sources/BaseSource").BaseSource}
     */
    createSource(id, stream, spatialize, audioContext) {
        if (spatialize) {
            return new ResonanceSource(id, stream, audioContext, this.scene);
        }
        else {
            return super.createSource(id, stream, spatialize, audioContext);
        }
    }
}

const BUFFER_SIZE = 1024,
    audioActivityEvt$1 = new AudioActivityEvent(),
    audioReadyEvt = new Event("audioready");

let hasAudioContext = Object.prototype.hasOwnProperty.call(window, "AudioContext"),
    hasAudioListener = hasAudioContext && Object.prototype.hasOwnProperty.call(window, "AudioListener"),
    hasOldAudioListener = hasAudioListener && Object.prototype.hasOwnProperty.call(AudioListener.prototype, "setPosition"),
    hasNewAudioListener = hasAudioListener && Object.prototype.hasOwnProperty.call(AudioListener.prototype, "positionX"),
    attemptResonanceAPI = hasAudioListener;

/**
 * A manager of audio sources, destinations, and their spatialization.
 **/
class AudioManager extends EventBase {

    /**
     * Creates a new manager of audio sources, destinations, and their spatialization.
     **/
    constructor() {
        super();

        this.minDistance = 1;
        this.minDistanceSq = 1;
        this.maxDistance = 10;
        this.maxDistanceSq = 100;
        this.rolloff = 1;
        this.transitionTime = 0.5;

        /** @type {Map<string, AudioSource>} */
        this.users = new Map();

        /** @type {Map<string, ActivityAnalyser>} */
        this.analysers = new Map();

        /** @type {Map<string, AudioSource>} */
        this.clips = new Map();

        /**
         * Forwards on the audioActivity of an audio source.
         * @param {AudioActivityEvent} evt
         * @fires AudioManager#audioActivity
         */
        this.onAudioActivity = (evt) => {
            audioActivityEvt$1.id = evt.id;
            audioActivityEvt$1.isActive = evt.isActive;
            this.dispatchEvent(audioActivityEvt$1);
        };

        /** @type {BaseListener} */
        this.listener = null;

        /** @type {AudioContext} */
        this.audioContext = null;

        this.createContext();

        Object.seal(this);
    }

    addEventListener(name, listener, opts) {
        if (name === audioReadyEvt.type
            && this.ready) {
            listener(audioReadyEvt);
        }
        else {
            super.addEventListener(name, listener, opts);
        }
    }

    get ready() {
        return this.audioContext && this.audioContext.state === "running";
    }

    /** 
     * Perform the audio system initialization, after a user gesture 
     **/
    async start() {
        this.createContext();
        await this.audioContext.resume();
    }

    update() {
        if (this.audioContext) {
            const t = this.currentTime;

            for (let clip of this.clips.values()) {
                clip.update(t);
            }

            for (let user of this.users.values()) {
                user.update(t);
            }

            for (let analyser of this.analysers.values()) {
                analyser.update(t);
            }
        }
    }

    /**
     * If no audio context is currently available, creates one, and initializes the
     * spatialization of its listener.
     * 
     * If WebAudio isn't available, a mock audio context is created that provides
     * ersatz playback timing.
     **/
    createContext() {
        if (!this.audioContext) {
            if (hasAudioContext) {
                try {
                    this.audioContext = new AudioContext();
                    if (this.ready) {
                        console.log("AudioContext is already running.");
                    }
                    else {
                        console.log("AudioContext is not yet running.");
                        onUserGesture(() => {
                            console.log("AudioContext is finally running.");
                            this.dispatchEvent(audioReadyEvt);
                        }, async () => {
                            await this.start();
                            return this.ready;
                        });
                    }
                }
                catch (exp) {
                    hasAudioContext = false;
                    console.warn("Could not create WebAudio AudioContext", exp);
                }
            }

            if (!hasAudioContext) {
                this.audioContext = new MockAudioContext();
            }

            if (hasAudioContext && attemptResonanceAPI) {
                try {
                    this.listener = new ResonanceScene(this.audioContext);
                }
                catch (exp) {
                    attemptResonanceAPI = false;
                    console.warn("Resonance Audio API not available!", exp);
                }
            }

            if (hasAudioContext && !attemptResonanceAPI && hasNewAudioListener) {
                try {
                    this.listener = new AudioListenerNew(this.audioContext.listener);
                }
                catch (exp) {
                    hasNewAudioListener = false;
                    console.warn("No AudioListener.positionX property!", exp);
                }
            }

            if (hasAudioContext && !attemptResonanceAPI && !hasNewAudioListener && hasOldAudioListener) {
                try {
                    this.listener = new AudioListenerOld(this.audioContext.listener);
                }
                catch (exp) {
                    hasOldAudioListener = false;
                    console.warn("No WebAudio API!", exp);
                }
            }

            if (!hasOldAudioListener || !hasAudioContext) {
                this.listener = new BaseListener();
            }
        }
    }

    /**
     * Creates a spatialzer for an audio source.
     * @private
     * @param {string} id
     * @param {MediaStream|HTMLAudioElement} stream - the audio element that is being spatialized.
     * @param {boolean} spatialize - whether or not the audio stream should be spatialized. Stereo audio streams that are spatialized will get down-mixed to a single channel.
     * @return {import("./spatializers/sources/BaseSource").BaseSource}
     */
    createSpatializer(id, stream, spatialize) {
        if (!this.listener) {
            throw new Error("Audio context isn't ready");
        }

        if (!stream) {
            throw new Error("No stream or audio element given.");
        }

        return this.listener.createSource(id, stream, spatialize, this.audioContext);
    }

    /**
     * Gets the current playback time.
     * @type {number}
     */
    get currentTime() {
        return this.audioContext.currentTime;
    }

    /**
     * Create a new user for audio processing.
     * @param {string} id
     * @returns {AudioSource}
     */
    createUser(id) {
        if (!this.users.has(id)) {
            this.users.set(id, new AudioSource());
        }

        return this.users.get(id);
    }

    /**
     * Create a new user for the audio listener.
     * @param {string} id
     * @returns {AudioSource}
     */
    createLocalUser(id) {
        const user = this.createUser(id);
        user.spatializer = this.listener;
        return user;
    }

    /**
     * Creates a new sound effect from a series of fallback paths
     * for media files.
     * @param {string} name - the name of the sound effect, to reference when executing playback.
     * @param {boolean} loop - whether or not the sound effect should be played on loop.
     * @param {boolean} autoPlay - whether or not the sound effect should be played immediately.
     * @param {boolean} spatialize - whether or not the sound effect should be spatialized.
     * @param {import("../fetching").progressCallback} - an optional callback function to use for tracking progress of loading the clip.
     * @param {...string} paths - a series of fallback paths for loading the media of the sound effect.
     */
    async createClip(name, loop, autoPlay, spatialize, onProgress, ...paths) {
        const clip = new AudioSource();

        const sources = [];
        for (let path of paths) {
            const s = document.createElement("source");
            if (onProgress) {
                path = await getFile(path, onProgress);
            }
            s.src = path;
            sources.push(s);
        }

        const elem = document.createElement("audio");
        elem.loop = loop;
        elem.controls = false;
        elem.playsInline = true;
        elem.autoplay = autoPlay;
        elem.append(...sources);

        clip.spatializer = this.createSpatializer(name, elem, spatialize);

        this.clips.set(name, clip);

        return clip;
    }

    /**
     * Plays a named sound effect.
     * @param {string} name - the name of the effect to play.
     * @param {number} [volume=1] - the volume at which to play the effect.
     */
    async playClip(name, volume = 1) {
        if (this.clips.has(name)) {
            const clip = this.clips.get(name);
            clip.volume = volume;
            await clip.spatializer.play();
        }
    }

    stopClip(name) {
        if (this.clips.has(name)) {
            const clip = this.clips.get(name);
            clip.spatializer.stop();
        }
    }

    /**
     * Get an audio source.
     * @param {Map<string, AudioSource>} sources - the collection of audio sources from which to retrieve.
     * @param {string} id - the id of the audio source to get
     **/
    getSource(sources, id) {
        return sources.get(id) || null;
    }

    /**
     * Get an existing user.
     * @param {string} id
     * @returns {AudioSource}
     */
    getUser(id) {
        return this.getSource(this.users, id);
    }

    /**
     * Get an existing audio clip.
     * @param {string} id
     * @returns {AudioSource}
     */
    getClip(id) {
        return this.getSource(this.clips, id);
    }

    /**
     * Remove an audio source from audio processing.
     * @param {Map<string, AudioSource>} sources - the collection of audio sources from which to remove.
     * @param {string} id - the id of the audio source to remove
     **/
    removeSource(sources, id) {
        if (sources.has(id)) {
            const source = sources.get(id);
            sources.delete(id);
            source.dispose();
        }
    }

    /**
     * Remove a user from audio processing.
     * @param {string} id - the id of the user to remove
     **/
    removeUser(id) {
        this.removeSource(this.users, id);
    }

    /**
     * Remove an audio clip from audio processing.
     * @param {string} id - the id of the audio clip to remove
     **/
    removeClip(id) {
        this.removeSource(this.clips, id);
    }

    /**
     * @param {string} id
     * @param {MediaStream|HTMLAudioElement} stream
     **/
    setUserStream(id, stream) {
        if (this.users.has(id)) {
            if (this.analysers.has(id)) {
                const analyser = this.analysers.get(id);
                this.analysers.delete(id);
                analyser.removeEventListener("audioActivity", this.onAudioActivity);
                analyser.dispose();
            }

            const user = this.users.get(id);
            user.spatializer = null;

            if (stream) {
                user.spatializer = this.createSpatializer(id, stream, true);
                user.spatializer.setAudioProperties(this.minDistance, this.maxDistance, this.rolloff, this.transitionTime);
                user.spatializer.audio.autoPlay = true;
                user.spatializer.audio.muted = true;
                user.spatializer.audio.addEventListener("onloadedmetadata", () =>
                    user.spatializer.audio.play());
                user.spatializer.audio.play();

                const analyser = new ActivityAnalyser(user, this.audioContext, BUFFER_SIZE);
                analyser.addEventListener("audioActivity", this.onAudioActivity);
                this.analysers.set(id, analyser);
            }
        }
    }

    /**
     * Sets parameters that alter spatialization.
     * @param {number} minDistance
     * @param {number} maxDistance
     * @param {number} rolloff
     * @param {number} transitionTime
     **/
    setAudioProperties(minDistance, maxDistance, rolloff, transitionTime) {
        this.minDistance = minDistance;
        this.maxDistance = maxDistance;
        this.transitionTime = transitionTime;
        this.rolloff = rolloff;

        for (let user of this.users.values()) {
            if (user.spatializer) {
                user.spatializer.setAudioProperties(this.minDistance, this.maxDistance, this.rolloff, this.transitionTime);
            }
        }

        for (let clip of this.clips.values()) {
            if (clip.spatializer) {
                clip.spatializer.setAudioProperties(this.minDistance, this.maxDistance, this.rolloff, this.transitionTime);
            }
        }
    }

    /**
     * @callback withPoseCallback
     * @param {InterpolatedPose} pose
     * @param {number} dt
     */

    /**
     * Get a pose, normalize the transition time, and perform on operation on it, if it exists.
     * @param {Map<string, AudioSource>} sources - the collection of poses from which to retrieve the pose.
     * @param {string} id - the id of the pose for which to perform the operation.
     * @param {number} dt - the amount of time to take to make the transition. Defaults to this AudioManager's `transitionTime`.
     * @param {withPoseCallback} poseCallback
     */
    withPose(sources, id, dt, poseCallback) {
        if (sources.has(id)) {
            const source = sources.get(id);
            const pose = source.pose;

            if (dt === null) {
                dt = this.transitionTime;
            }

            poseCallback(pose, dt);
        }
    }

    /**
     * Get a user pose, normalize the transition time, and perform on operation on it, if it exists.
     * @param {string} id - the id of the user for which to perform the operation.
     * @param {number} dt - the amount of time to take to make the transition. Defaults to this AudioManager's `transitionTime`.
     * @param {withPoseCallback} poseCallback
     */
    withUser(id, dt, poseCallback) {
        this.withPose(this.users, id, dt, poseCallback);
    }

    /**
     * Set the position of a user.
     * @param {string} id - the id of the user for which to set the position.
     * @param {number} x - the horizontal component of the position.
     * @param {number} y - the vertical component of the position.
     * @param {number} z - the lateral component of the position.
     * @param {number?} dt - the amount of time to take to make the transition. Defaults to this AudioManager's `transitionTime`.
     **/
    setUserPosition(id, x, y, z, dt = null) {
        this.withUser(id, dt, (pose, dt) => {
            pose.setTargetPosition(x, y, z, this.currentTime, dt);
        });
    }

    /**
     * Set the orientation of a user.
     * @param {string} id - the id of the user for which to set the position.
     * @param {number} fx - the horizontal component of the forward vector.
     * @param {number} fy - the vertical component of the forward vector.
     * @param {number} fz - the lateral component of the forward vector.
     * @param {number} ux - the horizontal component of the up vector.
     * @param {number} uy - the vertical component of the up vector.
     * @param {number} uz - the lateral component of the up vector.
     * @param {number?} dt - the amount of time to take to make the transition. Defaults to this AudioManager's `transitionTime`.
     **/
    setUserOrientation(id, fx, fy, fz, ux, uy, uz, dt = null) {
        this.withUser(id, dt, (pose, dt) => {
            pose.setTargetOrientation(fx, fy, fz, ux, uy, uz, this.currentTime, dt);
        });
    }

    /**
     * Set the position and orientation of a user.
     * @param {string} id - the id of the user for which to set the position.
     * @param {number} px - the horizontal component of the position.
     * @param {number} py - the vertical component of the position.
     * @param {number} pz - the lateral component of the position.
     * @param {number} fx - the horizontal component of the forward vector.
     * @param {number} fy - the vertical component of the forward vector.
     * @param {number} fz - the lateral component of the forward vector.
     * @param {number} ux - the horizontal component of the up vector.
     * @param {number} uy - the vertical component of the up vector.
     * @param {number} uz - the lateral component of the up vector.
     * @param {number?} dt - the amount of time to take to make the transition. Defaults to this AudioManager's `transitionTime`.
     **/
    setUserPose(id, px, py, pz, fx, fy, fz, ux, uy, uz, dt = null) {
        this.withUser(id, dt, (pose, dt) => {
            pose.setTarget(px, py, pz, fx, fy, fz, ux, uy, uz, this.currentTime, dt);
        });
    }

    /**
     * Get an audio clip pose, normalize the transition time, and perform on operation on it, if it exists.
     * @param {string} id - the id of the audio clip for which to perform the operation.
     * @param {number} dt - the amount of time to take to make the transition. Defaults to this AudioManager's `transitionTime`.
     * @param {withPoseCallback} poseCallback
     */
    withClip(id, dt, poseCallback) {
        this.withPose(this.clips, id, dt, poseCallback);
    }

    /**
     * Set the position of an audio clip.
     * @param {string} id - the id of the audio clip for which to set the position.
     * @param {number} x - the horizontal component of the position.
     * @param {number} y - the vertical component of the position.
     * @param {number} z - the lateral component of the position.
     * @param {number?} dt - the amount of time to take to make the transition. Defaults to this AudioManager's `transitionTime`.
     **/
    setClipPosition(id, x, y, z, dt = null) {
        this.withClip(id, dt, (pose, dt) => {
            pose.setTargetPosition(x, y, z, this.currentTime, dt);
        });
    }

    /**
     * Set the orientation of an audio clip.
     * @param {string} id - the id of the audio clip for which to set the position.
     * @param {number} fx - the horizontal component of the forward vector.
     * @param {number} fy - the vertical component of the forward vector.
     * @param {number} fz - the lateral component of the forward vector.
     * @param {number} ux - the horizontal component of the up vector.
     * @param {number} uy - the vertical component of the up vector.
     * @param {number} uz - the lateral component of the up vector.
     * @param {number?} dt - the amount of time to take to make the transition. Defaults to this AudioManager's `transitionTime`.
     **/
    setClipOrientation(id, fx, fy, fz, ux, uy, uz, dt = null) {
        this.withClip(id, dt, (pose, dt) => {
            pose.setTargetOrientation(fx, fy, fz, ux, uy, uz, this.currentTime, dt);
        });
    }

    /**
     * Set the position and orientation of an audio clip.
     * @param {string} id - the id of the audio clip for which to set the position.
     * @param {number} px - the horizontal component of the position.
     * @param {number} py - the vertical component of the position.
     * @param {number} pz - the lateral component of the position.
     * @param {number} fx - the horizontal component of the forward vector.
     * @param {number} fy - the vertical component of the forward vector.
     * @param {number} fz - the lateral component of the forward vector.
     * @param {number} ux - the horizontal component of the up vector.
     * @param {number} uy - the vertical component of the up vector.
     * @param {number} uz - the lateral component of the up vector.
     * @param {number?} dt - the amount of time to take to make the transition. Defaults to this AudioManager's `transitionTime`.
     **/
    setClipPose(id, px, py, pz, fx, fy, fz, ux, uy, uz, dt = null) {
        this.withClip(id, dt, (pose, dt) => {
            pose.setTarget(px, py, pz, fx, fy, fz, ux, uy, uz, this.currentTime, dt);
        });
    }
}

/*!
 * jQuery JavaScript Library v3.5.1
 * https://jquery.com/
 *
 * Includes Sizzle.js
 * https://sizzlejs.com/
 *
 * Copyright JS Foundation and other contributors
 * Released under the MIT license
 * https://jquery.org/license
 *
 * Date: 2020-05-04T22:49Z
 */
( function( global, factory ) {

	if ( typeof module === "object" && typeof module.exports === "object" ) {

		// For CommonJS and CommonJS-like environments where a proper `window`
		// is present, execute the factory and get jQuery.
		// For environments that do not have a `window` with a `document`
		// (such as Node.js), expose a factory as module.exports.
		// This accentuates the need for the creation of a real `window`.
		// e.g. var jQuery = require("jquery")(window);
		// See ticket #14549 for more info.
		module.exports = global.document ?
			factory( global, true ) :
			function( w ) {
				if ( !w.document ) {
					throw new Error( "jQuery requires a window with a document" );
				}
				return factory( w );
			};
	} else {
		factory( global );
	}

// Pass this if window is not defined yet
} )( window, function( window, noGlobal ) {

var arr = [];

var getProto = Object.getPrototypeOf;

var slice = arr.slice;

var flat = arr.flat ? function( array ) {
	return arr.flat.call( array );
} : function( array ) {
	return arr.concat.apply( [], array );
};


var push = arr.push;

var indexOf = arr.indexOf;

var class2type = {};

var toString = class2type.toString;

var hasOwn = class2type.hasOwnProperty;

var fnToString = hasOwn.toString;

var ObjectFunctionString = fnToString.call( Object );

var support = {};

var isFunction = function isFunction( obj ) {

      // Support: Chrome <=57, Firefox <=52
      // In some browsers, typeof returns "function" for HTML <object> elements
      // (i.e., `typeof document.createElement( "object" ) === "function"`).
      // We don't want to classify *any* DOM node as a function.
      return typeof obj === "function" && typeof obj.nodeType !== "number";
  };


var isWindow = function isWindow( obj ) {
		return obj != null && obj === obj.window;
	};


var document = window.document;



	var preservedScriptAttributes = {
		type: true,
		src: true,
		nonce: true,
		noModule: true
	};

	function DOMEval( code, node, doc ) {
		doc = doc || document;

		var i, val,
			script = doc.createElement( "script" );

		script.text = code;
		if ( node ) {
			for ( i in preservedScriptAttributes ) {

				// Support: Firefox 64+, Edge 18+
				// Some browsers don't support the "nonce" property on scripts.
				// On the other hand, just using `getAttribute` is not enough as
				// the `nonce` attribute is reset to an empty string whenever it
				// becomes browsing-context connected.
				// See https://github.com/whatwg/html/issues/2369
				// See https://html.spec.whatwg.org/#nonce-attributes
				// The `node.getAttribute` check was added for the sake of
				// `jQuery.globalEval` so that it can fake a nonce-containing node
				// via an object.
				val = node[ i ] || node.getAttribute && node.getAttribute( i );
				if ( val ) {
					script.setAttribute( i, val );
				}
			}
		}
		doc.head.appendChild( script ).parentNode.removeChild( script );
	}


function toType( obj ) {
	if ( obj == null ) {
		return obj + "";
	}

	// Support: Android <=2.3 only (functionish RegExp)
	return typeof obj === "object" || typeof obj === "function" ?
		class2type[ toString.call( obj ) ] || "object" :
		typeof obj;
}
/* global Symbol */
// Defining this global in .eslintrc.json would create a danger of using the global
// unguarded in another place, it seems safer to define global only for this module



var
	version = "3.5.1",

	// Define a local copy of jQuery
	jQuery = function( selector, context ) {

		// The jQuery object is actually just the init constructor 'enhanced'
		// Need init if jQuery is called (just allow error to be thrown if not included)
		return new jQuery.fn.init( selector, context );
	};

jQuery.fn = jQuery.prototype = {

	// The current version of jQuery being used
	jquery: version,

	constructor: jQuery,

	// The default length of a jQuery object is 0
	length: 0,

	toArray: function() {
		return slice.call( this );
	},

	// Get the Nth element in the matched element set OR
	// Get the whole matched element set as a clean array
	get: function( num ) {

		// Return all the elements in a clean array
		if ( num == null ) {
			return slice.call( this );
		}

		// Return just the one element from the set
		return num < 0 ? this[ num + this.length ] : this[ num ];
	},

	// Take an array of elements and push it onto the stack
	// (returning the new matched element set)
	pushStack: function( elems ) {

		// Build a new jQuery matched element set
		var ret = jQuery.merge( this.constructor(), elems );

		// Add the old object onto the stack (as a reference)
		ret.prevObject = this;

		// Return the newly-formed element set
		return ret;
	},

	// Execute a callback for every element in the matched set.
	each: function( callback ) {
		return jQuery.each( this, callback );
	},

	map: function( callback ) {
		return this.pushStack( jQuery.map( this, function( elem, i ) {
			return callback.call( elem, i, elem );
		} ) );
	},

	slice: function() {
		return this.pushStack( slice.apply( this, arguments ) );
	},

	first: function() {
		return this.eq( 0 );
	},

	last: function() {
		return this.eq( -1 );
	},

	even: function() {
		return this.pushStack( jQuery.grep( this, function( _elem, i ) {
			return ( i + 1 ) % 2;
		} ) );
	},

	odd: function() {
		return this.pushStack( jQuery.grep( this, function( _elem, i ) {
			return i % 2;
		} ) );
	},

	eq: function( i ) {
		var len = this.length,
			j = +i + ( i < 0 ? len : 0 );
		return this.pushStack( j >= 0 && j < len ? [ this[ j ] ] : [] );
	},

	end: function() {
		return this.prevObject || this.constructor();
	},

	// For internal use only.
	// Behaves like an Array's method, not like a jQuery method.
	push: push,
	sort: arr.sort,
	splice: arr.splice
};

jQuery.extend = jQuery.fn.extend = function() {
	var options, name, src, copy, copyIsArray, clone,
		target = arguments[ 0 ] || {},
		i = 1,
		length = arguments.length,
		deep = false;

	// Handle a deep copy situation
	if ( typeof target === "boolean" ) {
		deep = target;

		// Skip the boolean and the target
		target = arguments[ i ] || {};
		i++;
	}

	// Handle case when target is a string or something (possible in deep copy)
	if ( typeof target !== "object" && !isFunction( target ) ) {
		target = {};
	}

	// Extend jQuery itself if only one argument is passed
	if ( i === length ) {
		target = this;
		i--;
	}

	for ( ; i < length; i++ ) {

		// Only deal with non-null/undefined values
		if ( ( options = arguments[ i ] ) != null ) {

			// Extend the base object
			for ( name in options ) {
				copy = options[ name ];

				// Prevent Object.prototype pollution
				// Prevent never-ending loop
				if ( name === "__proto__" || target === copy ) {
					continue;
				}

				// Recurse if we're merging plain objects or arrays
				if ( deep && copy && ( jQuery.isPlainObject( copy ) ||
					( copyIsArray = Array.isArray( copy ) ) ) ) {
					src = target[ name ];

					// Ensure proper type for the source value
					if ( copyIsArray && !Array.isArray( src ) ) {
						clone = [];
					} else if ( !copyIsArray && !jQuery.isPlainObject( src ) ) {
						clone = {};
					} else {
						clone = src;
					}
					copyIsArray = false;

					// Never move original objects, clone them
					target[ name ] = jQuery.extend( deep, clone, copy );

				// Don't bring in undefined values
				} else if ( copy !== undefined ) {
					target[ name ] = copy;
				}
			}
		}
	}

	// Return the modified object
	return target;
};

jQuery.extend( {

	// Unique for each copy of jQuery on the page
	expando: "jQuery" + ( version + Math.random() ).replace( /\D/g, "" ),

	// Assume jQuery is ready without the ready module
	isReady: true,

	error: function( msg ) {
		throw new Error( msg );
	},

	noop: function() {},

	isPlainObject: function( obj ) {
		var proto, Ctor;

		// Detect obvious negatives
		// Use toString instead of jQuery.type to catch host objects
		if ( !obj || toString.call( obj ) !== "[object Object]" ) {
			return false;
		}

		proto = getProto( obj );

		// Objects with no prototype (e.g., `Object.create( null )`) are plain
		if ( !proto ) {
			return true;
		}

		// Objects with prototype are plain iff they were constructed by a global Object function
		Ctor = hasOwn.call( proto, "constructor" ) && proto.constructor;
		return typeof Ctor === "function" && fnToString.call( Ctor ) === ObjectFunctionString;
	},

	isEmptyObject: function( obj ) {
		var name;

		for ( name in obj ) {
			return false;
		}
		return true;
	},

	// Evaluates a script in a provided context; falls back to the global one
	// if not specified.
	globalEval: function( code, options, doc ) {
		DOMEval( code, { nonce: options && options.nonce }, doc );
	},

	each: function( obj, callback ) {
		var length, i = 0;

		if ( isArrayLike( obj ) ) {
			length = obj.length;
			for ( ; i < length; i++ ) {
				if ( callback.call( obj[ i ], i, obj[ i ] ) === false ) {
					break;
				}
			}
		} else {
			for ( i in obj ) {
				if ( callback.call( obj[ i ], i, obj[ i ] ) === false ) {
					break;
				}
			}
		}

		return obj;
	},

	// results is for internal usage only
	makeArray: function( arr, results ) {
		var ret = results || [];

		if ( arr != null ) {
			if ( isArrayLike( Object( arr ) ) ) {
				jQuery.merge( ret,
					typeof arr === "string" ?
					[ arr ] : arr
				);
			} else {
				push.call( ret, arr );
			}
		}

		return ret;
	},

	inArray: function( elem, arr, i ) {
		return arr == null ? -1 : indexOf.call( arr, elem, i );
	},

	// Support: Android <=4.0 only, PhantomJS 1 only
	// push.apply(_, arraylike) throws on ancient WebKit
	merge: function( first, second ) {
		var len = +second.length,
			j = 0,
			i = first.length;

		for ( ; j < len; j++ ) {
			first[ i++ ] = second[ j ];
		}

		first.length = i;

		return first;
	},

	grep: function( elems, callback, invert ) {
		var callbackInverse,
			matches = [],
			i = 0,
			length = elems.length,
			callbackExpect = !invert;

		// Go through the array, only saving the items
		// that pass the validator function
		for ( ; i < length; i++ ) {
			callbackInverse = !callback( elems[ i ], i );
			if ( callbackInverse !== callbackExpect ) {
				matches.push( elems[ i ] );
			}
		}

		return matches;
	},

	// arg is for internal usage only
	map: function( elems, callback, arg ) {
		var length, value,
			i = 0,
			ret = [];

		// Go through the array, translating each of the items to their new values
		if ( isArrayLike( elems ) ) {
			length = elems.length;
			for ( ; i < length; i++ ) {
				value = callback( elems[ i ], i, arg );

				if ( value != null ) {
					ret.push( value );
				}
			}

		// Go through every key on the object,
		} else {
			for ( i in elems ) {
				value = callback( elems[ i ], i, arg );

				if ( value != null ) {
					ret.push( value );
				}
			}
		}

		// Flatten any nested arrays
		return flat( ret );
	},

	// A global GUID counter for objects
	guid: 1,

	// jQuery.support is not used in Core but other projects attach their
	// properties to it so it needs to exist.
	support: support
} );

if ( typeof Symbol === "function" ) {
	jQuery.fn[ Symbol.iterator ] = arr[ Symbol.iterator ];
}

// Populate the class2type map
jQuery.each( "Boolean Number String Function Array Date RegExp Object Error Symbol".split( " " ),
function( _i, name ) {
	class2type[ "[object " + name + "]" ] = name.toLowerCase();
} );

function isArrayLike( obj ) {

	// Support: real iOS 8.2 only (not reproducible in simulator)
	// `in` check used to prevent JIT error (gh-2145)
	// hasOwn isn't used here due to false negatives
	// regarding Nodelist length in IE
	var length = !!obj && "length" in obj && obj.length,
		type = toType( obj );

	if ( isFunction( obj ) || isWindow( obj ) ) {
		return false;
	}

	return type === "array" || length === 0 ||
		typeof length === "number" && length > 0 && ( length - 1 ) in obj;
}
var Sizzle =
/*!
 * Sizzle CSS Selector Engine v2.3.5
 * https://sizzlejs.com/
 *
 * Copyright JS Foundation and other contributors
 * Released under the MIT license
 * https://js.foundation/
 *
 * Date: 2020-03-14
 */
( function( window ) {
var i,
	support,
	Expr,
	getText,
	isXML,
	tokenize,
	compile,
	select,
	outermostContext,
	sortInput,
	hasDuplicate,

	// Local document vars
	setDocument,
	document,
	docElem,
	documentIsHTML,
	rbuggyQSA,
	rbuggyMatches,
	matches,
	contains,

	// Instance-specific data
	expando = "sizzle" + 1 * new Date(),
	preferredDoc = window.document,
	dirruns = 0,
	done = 0,
	classCache = createCache(),
	tokenCache = createCache(),
	compilerCache = createCache(),
	nonnativeSelectorCache = createCache(),
	sortOrder = function( a, b ) {
		if ( a === b ) {
			hasDuplicate = true;
		}
		return 0;
	},

	// Instance methods
	hasOwn = ( {} ).hasOwnProperty,
	arr = [],
	pop = arr.pop,
	pushNative = arr.push,
	push = arr.push,
	slice = arr.slice,

	// Use a stripped-down indexOf as it's faster than native
	// https://jsperf.com/thor-indexof-vs-for/5
	indexOf = function( list, elem ) {
		var i = 0,
			len = list.length;
		for ( ; i < len; i++ ) {
			if ( list[ i ] === elem ) {
				return i;
			}
		}
		return -1;
	},

	booleans = "checked|selected|async|autofocus|autoplay|controls|defer|disabled|hidden|" +
		"ismap|loop|multiple|open|readonly|required|scoped",

	// Regular expressions

	// http://www.w3.org/TR/css3-selectors/#whitespace
	whitespace = "[\\x20\\t\\r\\n\\f]",

	// https://www.w3.org/TR/css-syntax-3/#ident-token-diagram
	identifier = "(?:\\\\[\\da-fA-F]{1,6}" + whitespace +
		"?|\\\\[^\\r\\n\\f]|[\\w-]|[^\0-\\x7f])+",

	// Attribute selectors: http://www.w3.org/TR/selectors/#attribute-selectors
	attributes = "\\[" + whitespace + "*(" + identifier + ")(?:" + whitespace +

		// Operator (capture 2)
		"*([*^$|!~]?=)" + whitespace +

		// "Attribute values must be CSS identifiers [capture 5]
		// or strings [capture 3 or capture 4]"
		"*(?:'((?:\\\\.|[^\\\\'])*)'|\"((?:\\\\.|[^\\\\\"])*)\"|(" + identifier + "))|)" +
		whitespace + "*\\]",

	pseudos = ":(" + identifier + ")(?:\\((" +

		// To reduce the number of selectors needing tokenize in the preFilter, prefer arguments:
		// 1. quoted (capture 3; capture 4 or capture 5)
		"('((?:\\\\.|[^\\\\'])*)'|\"((?:\\\\.|[^\\\\\"])*)\")|" +

		// 2. simple (capture 6)
		"((?:\\\\.|[^\\\\()[\\]]|" + attributes + ")*)|" +

		// 3. anything else (capture 2)
		".*" +
		")\\)|)",

	// Leading and non-escaped trailing whitespace, capturing some non-whitespace characters preceding the latter
	rwhitespace = new RegExp( whitespace + "+", "g" ),
	rtrim = new RegExp( "^" + whitespace + "+|((?:^|[^\\\\])(?:\\\\.)*)" +
		whitespace + "+$", "g" ),

	rcomma = new RegExp( "^" + whitespace + "*," + whitespace + "*" ),
	rcombinators = new RegExp( "^" + whitespace + "*([>+~]|" + whitespace + ")" + whitespace +
		"*" ),
	rdescend = new RegExp( whitespace + "|>" ),

	rpseudo = new RegExp( pseudos ),
	ridentifier = new RegExp( "^" + identifier + "$" ),

	matchExpr = {
		"ID": new RegExp( "^#(" + identifier + ")" ),
		"CLASS": new RegExp( "^\\.(" + identifier + ")" ),
		"TAG": new RegExp( "^(" + identifier + "|[*])" ),
		"ATTR": new RegExp( "^" + attributes ),
		"PSEUDO": new RegExp( "^" + pseudos ),
		"CHILD": new RegExp( "^:(only|first|last|nth|nth-last)-(child|of-type)(?:\\(" +
			whitespace + "*(even|odd|(([+-]|)(\\d*)n|)" + whitespace + "*(?:([+-]|)" +
			whitespace + "*(\\d+)|))" + whitespace + "*\\)|)", "i" ),
		"bool": new RegExp( "^(?:" + booleans + ")$", "i" ),

		// For use in libraries implementing .is()
		// We use this for POS matching in `select`
		"needsContext": new RegExp( "^" + whitespace +
			"*[>+~]|:(even|odd|eq|gt|lt|nth|first|last)(?:\\(" + whitespace +
			"*((?:-\\d)?\\d*)" + whitespace + "*\\)|)(?=[^-]|$)", "i" )
	},

	rhtml = /HTML$/i,
	rinputs = /^(?:input|select|textarea|button)$/i,
	rheader = /^h\d$/i,

	rnative = /^[^{]+\{\s*\[native \w/,

	// Easily-parseable/retrievable ID or TAG or CLASS selectors
	rquickExpr = /^(?:#([\w-]+)|(\w+)|\.([\w-]+))$/,

	rsibling = /[+~]/,

	// CSS escapes
	// http://www.w3.org/TR/CSS21/syndata.html#escaped-characters
	runescape = new RegExp( "\\\\[\\da-fA-F]{1,6}" + whitespace + "?|\\\\([^\\r\\n\\f])", "g" ),
	funescape = function( escape, nonHex ) {
		var high = "0x" + escape.slice( 1 ) - 0x10000;

		return nonHex ?

			// Strip the backslash prefix from a non-hex escape sequence
			nonHex :

			// Replace a hexadecimal escape sequence with the encoded Unicode code point
			// Support: IE <=11+
			// For values outside the Basic Multilingual Plane (BMP), manually construct a
			// surrogate pair
			high < 0 ?
				String.fromCharCode( high + 0x10000 ) :
				String.fromCharCode( high >> 10 | 0xD800, high & 0x3FF | 0xDC00 );
	},

	// CSS string/identifier serialization
	// https://drafts.csswg.org/cssom/#common-serializing-idioms
	rcssescape = /([\0-\x1f\x7f]|^-?\d)|^-$|[^\0-\x1f\x7f-\uFFFF\w-]/g,
	fcssescape = function( ch, asCodePoint ) {
		if ( asCodePoint ) {

			// U+0000 NULL becomes U+FFFD REPLACEMENT CHARACTER
			if ( ch === "\0" ) {
				return "\uFFFD";
			}

			// Control characters and (dependent upon position) numbers get escaped as code points
			return ch.slice( 0, -1 ) + "\\" +
				ch.charCodeAt( ch.length - 1 ).toString( 16 ) + " ";
		}

		// Other potentially-special ASCII characters get backslash-escaped
		return "\\" + ch;
	},

	// Used for iframes
	// See setDocument()
	// Removing the function wrapper causes a "Permission Denied"
	// error in IE
	unloadHandler = function() {
		setDocument();
	},

	inDisabledFieldset = addCombinator(
		function( elem ) {
			return elem.disabled === true && elem.nodeName.toLowerCase() === "fieldset";
		},
		{ dir: "parentNode", next: "legend" }
	);

// Optimize for push.apply( _, NodeList )
try {
	push.apply(
		( arr = slice.call( preferredDoc.childNodes ) ),
		preferredDoc.childNodes
	);

	// Support: Android<4.0
	// Detect silently failing push.apply
	// eslint-disable-next-line no-unused-expressions
	arr[ preferredDoc.childNodes.length ].nodeType;
} catch ( e ) {
	push = { apply: arr.length ?

		// Leverage slice if possible
		function( target, els ) {
			pushNative.apply( target, slice.call( els ) );
		} :

		// Support: IE<9
		// Otherwise append directly
		function( target, els ) {
			var j = target.length,
				i = 0;

			// Can't trust NodeList.length
			while ( ( target[ j++ ] = els[ i++ ] ) ) {}
			target.length = j - 1;
		}
	};
}

function Sizzle( selector, context, results, seed ) {
	var m, i, elem, nid, match, groups, newSelector,
		newContext = context && context.ownerDocument,

		// nodeType defaults to 9, since context defaults to document
		nodeType = context ? context.nodeType : 9;

	results = results || [];

	// Return early from calls with invalid selector or context
	if ( typeof selector !== "string" || !selector ||
		nodeType !== 1 && nodeType !== 9 && nodeType !== 11 ) {

		return results;
	}

	// Try to shortcut find operations (as opposed to filters) in HTML documents
	if ( !seed ) {
		setDocument( context );
		context = context || document;

		if ( documentIsHTML ) {

			// If the selector is sufficiently simple, try using a "get*By*" DOM method
			// (excepting DocumentFragment context, where the methods don't exist)
			if ( nodeType !== 11 && ( match = rquickExpr.exec( selector ) ) ) {

				// ID selector
				if ( ( m = match[ 1 ] ) ) {

					// Document context
					if ( nodeType === 9 ) {
						if ( ( elem = context.getElementById( m ) ) ) {

							// Support: IE, Opera, Webkit
							// TODO: identify versions
							// getElementById can match elements by name instead of ID
							if ( elem.id === m ) {
								results.push( elem );
								return results;
							}
						} else {
							return results;
						}

					// Element context
					} else {

						// Support: IE, Opera, Webkit
						// TODO: identify versions
						// getElementById can match elements by name instead of ID
						if ( newContext && ( elem = newContext.getElementById( m ) ) &&
							contains( context, elem ) &&
							elem.id === m ) {

							results.push( elem );
							return results;
						}
					}

				// Type selector
				} else if ( match[ 2 ] ) {
					push.apply( results, context.getElementsByTagName( selector ) );
					return results;

				// Class selector
				} else if ( ( m = match[ 3 ] ) && support.getElementsByClassName &&
					context.getElementsByClassName ) {

					push.apply( results, context.getElementsByClassName( m ) );
					return results;
				}
			}

			// Take advantage of querySelectorAll
			if ( support.qsa &&
				!nonnativeSelectorCache[ selector + " " ] &&
				( !rbuggyQSA || !rbuggyQSA.test( selector ) ) &&

				// Support: IE 8 only
				// Exclude object elements
				( nodeType !== 1 || context.nodeName.toLowerCase() !== "object" ) ) {

				newSelector = selector;
				newContext = context;

				// qSA considers elements outside a scoping root when evaluating child or
				// descendant combinators, which is not what we want.
				// In such cases, we work around the behavior by prefixing every selector in the
				// list with an ID selector referencing the scope context.
				// The technique has to be used as well when a leading combinator is used
				// as such selectors are not recognized by querySelectorAll.
				// Thanks to Andrew Dupont for this technique.
				if ( nodeType === 1 &&
					( rdescend.test( selector ) || rcombinators.test( selector ) ) ) {

					// Expand context for sibling selectors
					newContext = rsibling.test( selector ) && testContext( context.parentNode ) ||
						context;

					// We can use :scope instead of the ID hack if the browser
					// supports it & if we're not changing the context.
					if ( newContext !== context || !support.scope ) {

						// Capture the context ID, setting it first if necessary
						if ( ( nid = context.getAttribute( "id" ) ) ) {
							nid = nid.replace( rcssescape, fcssescape );
						} else {
							context.setAttribute( "id", ( nid = expando ) );
						}
					}

					// Prefix every selector in the list
					groups = tokenize( selector );
					i = groups.length;
					while ( i-- ) {
						groups[ i ] = ( nid ? "#" + nid : ":scope" ) + " " +
							toSelector( groups[ i ] );
					}
					newSelector = groups.join( "," );
				}

				try {
					push.apply( results,
						newContext.querySelectorAll( newSelector )
					);
					return results;
				} catch ( qsaError ) {
					nonnativeSelectorCache( selector, true );
				} finally {
					if ( nid === expando ) {
						context.removeAttribute( "id" );
					}
				}
			}
		}
	}

	// All others
	return select( selector.replace( rtrim, "$1" ), context, results, seed );
}

/**
 * Create key-value caches of limited size
 * @returns {function(string, object)} Returns the Object data after storing it on itself with
 *	property name the (space-suffixed) string and (if the cache is larger than Expr.cacheLength)
 *	deleting the oldest entry
 */
function createCache() {
	var keys = [];

	function cache( key, value ) {

		// Use (key + " ") to avoid collision with native prototype properties (see Issue #157)
		if ( keys.push( key + " " ) > Expr.cacheLength ) {

			// Only keep the most recent entries
			delete cache[ keys.shift() ];
		}
		return ( cache[ key + " " ] = value );
	}
	return cache;
}

/**
 * Mark a function for special use by Sizzle
 * @param {Function} fn The function to mark
 */
function markFunction( fn ) {
	fn[ expando ] = true;
	return fn;
}

/**
 * Support testing using an element
 * @param {Function} fn Passed the created element and returns a boolean result
 */
function assert( fn ) {
	var el = document.createElement( "fieldset" );

	try {
		return !!fn( el );
	} catch ( e ) {
		return false;
	} finally {

		// Remove from its parent by default
		if ( el.parentNode ) {
			el.parentNode.removeChild( el );
		}

		// release memory in IE
		el = null;
	}
}

/**
 * Adds the same handler for all of the specified attrs
 * @param {String} attrs Pipe-separated list of attributes
 * @param {Function} handler The method that will be applied
 */
function addHandle( attrs, handler ) {
	var arr = attrs.split( "|" ),
		i = arr.length;

	while ( i-- ) {
		Expr.attrHandle[ arr[ i ] ] = handler;
	}
}

/**
 * Checks document order of two siblings
 * @param {Element} a
 * @param {Element} b
 * @returns {Number} Returns less than 0 if a precedes b, greater than 0 if a follows b
 */
function siblingCheck( a, b ) {
	var cur = b && a,
		diff = cur && a.nodeType === 1 && b.nodeType === 1 &&
			a.sourceIndex - b.sourceIndex;

	// Use IE sourceIndex if available on both nodes
	if ( diff ) {
		return diff;
	}

	// Check if b follows a
	if ( cur ) {
		while ( ( cur = cur.nextSibling ) ) {
			if ( cur === b ) {
				return -1;
			}
		}
	}

	return a ? 1 : -1;
}

/**
 * Returns a function to use in pseudos for input types
 * @param {String} type
 */
function createInputPseudo( type ) {
	return function( elem ) {
		var name = elem.nodeName.toLowerCase();
		return name === "input" && elem.type === type;
	};
}

/**
 * Returns a function to use in pseudos for buttons
 * @param {String} type
 */
function createButtonPseudo( type ) {
	return function( elem ) {
		var name = elem.nodeName.toLowerCase();
		return ( name === "input" || name === "button" ) && elem.type === type;
	};
}

/**
 * Returns a function to use in pseudos for :enabled/:disabled
 * @param {Boolean} disabled true for :disabled; false for :enabled
 */
function createDisabledPseudo( disabled ) {

	// Known :disabled false positives: fieldset[disabled] > legend:nth-of-type(n+2) :can-disable
	return function( elem ) {

		// Only certain elements can match :enabled or :disabled
		// https://html.spec.whatwg.org/multipage/scripting.html#selector-enabled
		// https://html.spec.whatwg.org/multipage/scripting.html#selector-disabled
		if ( "form" in elem ) {

			// Check for inherited disabledness on relevant non-disabled elements:
			// * listed form-associated elements in a disabled fieldset
			//   https://html.spec.whatwg.org/multipage/forms.html#category-listed
			//   https://html.spec.whatwg.org/multipage/forms.html#concept-fe-disabled
			// * option elements in a disabled optgroup
			//   https://html.spec.whatwg.org/multipage/forms.html#concept-option-disabled
			// All such elements have a "form" property.
			if ( elem.parentNode && elem.disabled === false ) {

				// Option elements defer to a parent optgroup if present
				if ( "label" in elem ) {
					if ( "label" in elem.parentNode ) {
						return elem.parentNode.disabled === disabled;
					} else {
						return elem.disabled === disabled;
					}
				}

				// Support: IE 6 - 11
				// Use the isDisabled shortcut property to check for disabled fieldset ancestors
				return elem.isDisabled === disabled ||

					// Where there is no isDisabled, check manually
					/* jshint -W018 */
					elem.isDisabled !== !disabled &&
					inDisabledFieldset( elem ) === disabled;
			}

			return elem.disabled === disabled;

		// Try to winnow out elements that can't be disabled before trusting the disabled property.
		// Some victims get caught in our net (label, legend, menu, track), but it shouldn't
		// even exist on them, let alone have a boolean value.
		} else if ( "label" in elem ) {
			return elem.disabled === disabled;
		}

		// Remaining elements are neither :enabled nor :disabled
		return false;
	};
}

/**
 * Returns a function to use in pseudos for positionals
 * @param {Function} fn
 */
function createPositionalPseudo( fn ) {
	return markFunction( function( argument ) {
		argument = +argument;
		return markFunction( function( seed, matches ) {
			var j,
				matchIndexes = fn( [], seed.length, argument ),
				i = matchIndexes.length;

			// Match elements found at the specified indexes
			while ( i-- ) {
				if ( seed[ ( j = matchIndexes[ i ] ) ] ) {
					seed[ j ] = !( matches[ j ] = seed[ j ] );
				}
			}
		} );
	} );
}

/**
 * Checks a node for validity as a Sizzle context
 * @param {Element|Object=} context
 * @returns {Element|Object|Boolean} The input node if acceptable, otherwise a falsy value
 */
function testContext( context ) {
	return context && typeof context.getElementsByTagName !== "undefined" && context;
}

// Expose support vars for convenience
support = Sizzle.support = {};

/**
 * Detects XML nodes
 * @param {Element|Object} elem An element or a document
 * @returns {Boolean} True iff elem is a non-HTML XML node
 */
isXML = Sizzle.isXML = function( elem ) {
	var namespace = elem.namespaceURI,
		docElem = ( elem.ownerDocument || elem ).documentElement;

	// Support: IE <=8
	// Assume HTML when documentElement doesn't yet exist, such as inside loading iframes
	// https://bugs.jquery.com/ticket/4833
	return !rhtml.test( namespace || docElem && docElem.nodeName || "HTML" );
};

/**
 * Sets document-related variables once based on the current document
 * @param {Element|Object} [doc] An element or document object to use to set the document
 * @returns {Object} Returns the current document
 */
setDocument = Sizzle.setDocument = function( node ) {
	var hasCompare, subWindow,
		doc = node ? node.ownerDocument || node : preferredDoc;

	// Return early if doc is invalid or already selected
	// Support: IE 11+, Edge 17 - 18+
	// IE/Edge sometimes throw a "Permission denied" error when strict-comparing
	// two documents; shallow comparisons work.
	// eslint-disable-next-line eqeqeq
	if ( doc == document || doc.nodeType !== 9 || !doc.documentElement ) {
		return document;
	}

	// Update global variables
	document = doc;
	docElem = document.documentElement;
	documentIsHTML = !isXML( document );

	// Support: IE 9 - 11+, Edge 12 - 18+
	// Accessing iframe documents after unload throws "permission denied" errors (jQuery #13936)
	// Support: IE 11+, Edge 17 - 18+
	// IE/Edge sometimes throw a "Permission denied" error when strict-comparing
	// two documents; shallow comparisons work.
	// eslint-disable-next-line eqeqeq
	if ( preferredDoc != document &&
		( subWindow = document.defaultView ) && subWindow.top !== subWindow ) {

		// Support: IE 11, Edge
		if ( subWindow.addEventListener ) {
			subWindow.addEventListener( "unload", unloadHandler, false );

		// Support: IE 9 - 10 only
		} else if ( subWindow.attachEvent ) {
			subWindow.attachEvent( "onunload", unloadHandler );
		}
	}

	// Support: IE 8 - 11+, Edge 12 - 18+, Chrome <=16 - 25 only, Firefox <=3.6 - 31 only,
	// Safari 4 - 5 only, Opera <=11.6 - 12.x only
	// IE/Edge & older browsers don't support the :scope pseudo-class.
	// Support: Safari 6.0 only
	// Safari 6.0 supports :scope but it's an alias of :root there.
	support.scope = assert( function( el ) {
		docElem.appendChild( el ).appendChild( document.createElement( "div" ) );
		return typeof el.querySelectorAll !== "undefined" &&
			!el.querySelectorAll( ":scope fieldset div" ).length;
	} );

	/* Attributes
	---------------------------------------------------------------------- */

	// Support: IE<8
	// Verify that getAttribute really returns attributes and not properties
	// (excepting IE8 booleans)
	support.attributes = assert( function( el ) {
		el.className = "i";
		return !el.getAttribute( "className" );
	} );

	/* getElement(s)By*
	---------------------------------------------------------------------- */

	// Check if getElementsByTagName("*") returns only elements
	support.getElementsByTagName = assert( function( el ) {
		el.appendChild( document.createComment( "" ) );
		return !el.getElementsByTagName( "*" ).length;
	} );

	// Support: IE<9
	support.getElementsByClassName = rnative.test( document.getElementsByClassName );

	// Support: IE<10
	// Check if getElementById returns elements by name
	// The broken getElementById methods don't pick up programmatically-set names,
	// so use a roundabout getElementsByName test
	support.getById = assert( function( el ) {
		docElem.appendChild( el ).id = expando;
		return !document.getElementsByName || !document.getElementsByName( expando ).length;
	} );

	// ID filter and find
	if ( support.getById ) {
		Expr.filter[ "ID" ] = function( id ) {
			var attrId = id.replace( runescape, funescape );
			return function( elem ) {
				return elem.getAttribute( "id" ) === attrId;
			};
		};
		Expr.find[ "ID" ] = function( id, context ) {
			if ( typeof context.getElementById !== "undefined" && documentIsHTML ) {
				var elem = context.getElementById( id );
				return elem ? [ elem ] : [];
			}
		};
	} else {
		Expr.filter[ "ID" ] =  function( id ) {
			var attrId = id.replace( runescape, funescape );
			return function( elem ) {
				var node = typeof elem.getAttributeNode !== "undefined" &&
					elem.getAttributeNode( "id" );
				return node && node.value === attrId;
			};
		};

		// Support: IE 6 - 7 only
		// getElementById is not reliable as a find shortcut
		Expr.find[ "ID" ] = function( id, context ) {
			if ( typeof context.getElementById !== "undefined" && documentIsHTML ) {
				var node, i, elems,
					elem = context.getElementById( id );

				if ( elem ) {

					// Verify the id attribute
					node = elem.getAttributeNode( "id" );
					if ( node && node.value === id ) {
						return [ elem ];
					}

					// Fall back on getElementsByName
					elems = context.getElementsByName( id );
					i = 0;
					while ( ( elem = elems[ i++ ] ) ) {
						node = elem.getAttributeNode( "id" );
						if ( node && node.value === id ) {
							return [ elem ];
						}
					}
				}

				return [];
			}
		};
	}

	// Tag
	Expr.find[ "TAG" ] = support.getElementsByTagName ?
		function( tag, context ) {
			if ( typeof context.getElementsByTagName !== "undefined" ) {
				return context.getElementsByTagName( tag );

			// DocumentFragment nodes don't have gEBTN
			} else if ( support.qsa ) {
				return context.querySelectorAll( tag );
			}
		} :

		function( tag, context ) {
			var elem,
				tmp = [],
				i = 0,

				// By happy coincidence, a (broken) gEBTN appears on DocumentFragment nodes too
				results = context.getElementsByTagName( tag );

			// Filter out possible comments
			if ( tag === "*" ) {
				while ( ( elem = results[ i++ ] ) ) {
					if ( elem.nodeType === 1 ) {
						tmp.push( elem );
					}
				}

				return tmp;
			}
			return results;
		};

	// Class
	Expr.find[ "CLASS" ] = support.getElementsByClassName && function( className, context ) {
		if ( typeof context.getElementsByClassName !== "undefined" && documentIsHTML ) {
			return context.getElementsByClassName( className );
		}
	};

	/* QSA/matchesSelector
	---------------------------------------------------------------------- */

	// QSA and matchesSelector support

	// matchesSelector(:active) reports false when true (IE9/Opera 11.5)
	rbuggyMatches = [];

	// qSa(:focus) reports false when true (Chrome 21)
	// We allow this because of a bug in IE8/9 that throws an error
	// whenever `document.activeElement` is accessed on an iframe
	// So, we allow :focus to pass through QSA all the time to avoid the IE error
	// See https://bugs.jquery.com/ticket/13378
	rbuggyQSA = [];

	if ( ( support.qsa = rnative.test( document.querySelectorAll ) ) ) {

		// Build QSA regex
		// Regex strategy adopted from Diego Perini
		assert( function( el ) {

			var input;

			// Select is set to empty string on purpose
			// This is to test IE's treatment of not explicitly
			// setting a boolean content attribute,
			// since its presence should be enough
			// https://bugs.jquery.com/ticket/12359
			docElem.appendChild( el ).innerHTML = "<a id='" + expando + "'></a>" +
				"<select id='" + expando + "-\r\\' msallowcapture=''>" +
				"<option selected=''></option></select>";

			// Support: IE8, Opera 11-12.16
			// Nothing should be selected when empty strings follow ^= or $= or *=
			// The test attribute must be unknown in Opera but "safe" for WinRT
			// https://msdn.microsoft.com/en-us/library/ie/hh465388.aspx#attribute_section
			if ( el.querySelectorAll( "[msallowcapture^='']" ).length ) {
				rbuggyQSA.push( "[*^$]=" + whitespace + "*(?:''|\"\")" );
			}

			// Support: IE8
			// Boolean attributes and "value" are not treated correctly
			if ( !el.querySelectorAll( "[selected]" ).length ) {
				rbuggyQSA.push( "\\[" + whitespace + "*(?:value|" + booleans + ")" );
			}

			// Support: Chrome<29, Android<4.4, Safari<7.0+, iOS<7.0+, PhantomJS<1.9.8+
			if ( !el.querySelectorAll( "[id~=" + expando + "-]" ).length ) {
				rbuggyQSA.push( "~=" );
			}

			// Support: IE 11+, Edge 15 - 18+
			// IE 11/Edge don't find elements on a `[name='']` query in some cases.
			// Adding a temporary attribute to the document before the selection works
			// around the issue.
			// Interestingly, IE 10 & older don't seem to have the issue.
			input = document.createElement( "input" );
			input.setAttribute( "name", "" );
			el.appendChild( input );
			if ( !el.querySelectorAll( "[name='']" ).length ) {
				rbuggyQSA.push( "\\[" + whitespace + "*name" + whitespace + "*=" +
					whitespace + "*(?:''|\"\")" );
			}

			// Webkit/Opera - :checked should return selected option elements
			// http://www.w3.org/TR/2011/REC-css3-selectors-20110929/#checked
			// IE8 throws error here and will not see later tests
			if ( !el.querySelectorAll( ":checked" ).length ) {
				rbuggyQSA.push( ":checked" );
			}

			// Support: Safari 8+, iOS 8+
			// https://bugs.webkit.org/show_bug.cgi?id=136851
			// In-page `selector#id sibling-combinator selector` fails
			if ( !el.querySelectorAll( "a#" + expando + "+*" ).length ) {
				rbuggyQSA.push( ".#.+[+~]" );
			}

			// Support: Firefox <=3.6 - 5 only
			// Old Firefox doesn't throw on a badly-escaped identifier.
			el.querySelectorAll( "\\\f" );
			rbuggyQSA.push( "[\\r\\n\\f]" );
		} );

		assert( function( el ) {
			el.innerHTML = "<a href='' disabled='disabled'></a>" +
				"<select disabled='disabled'><option/></select>";

			// Support: Windows 8 Native Apps
			// The type and name attributes are restricted during .innerHTML assignment
			var input = document.createElement( "input" );
			input.setAttribute( "type", "hidden" );
			el.appendChild( input ).setAttribute( "name", "D" );

			// Support: IE8
			// Enforce case-sensitivity of name attribute
			if ( el.querySelectorAll( "[name=d]" ).length ) {
				rbuggyQSA.push( "name" + whitespace + "*[*^$|!~]?=" );
			}

			// FF 3.5 - :enabled/:disabled and hidden elements (hidden elements are still enabled)
			// IE8 throws error here and will not see later tests
			if ( el.querySelectorAll( ":enabled" ).length !== 2 ) {
				rbuggyQSA.push( ":enabled", ":disabled" );
			}

			// Support: IE9-11+
			// IE's :disabled selector does not pick up the children of disabled fieldsets
			docElem.appendChild( el ).disabled = true;
			if ( el.querySelectorAll( ":disabled" ).length !== 2 ) {
				rbuggyQSA.push( ":enabled", ":disabled" );
			}

			// Support: Opera 10 - 11 only
			// Opera 10-11 does not throw on post-comma invalid pseudos
			el.querySelectorAll( "*,:x" );
			rbuggyQSA.push( ",.*:" );
		} );
	}

	if ( ( support.matchesSelector = rnative.test( ( matches = docElem.matches ||
		docElem.webkitMatchesSelector ||
		docElem.mozMatchesSelector ||
		docElem.oMatchesSelector ||
		docElem.msMatchesSelector ) ) ) ) {

		assert( function( el ) {

			// Check to see if it's possible to do matchesSelector
			// on a disconnected node (IE 9)
			support.disconnectedMatch = matches.call( el, "*" );

			// This should fail with an exception
			// Gecko does not error, returns false instead
			matches.call( el, "[s!='']:x" );
			rbuggyMatches.push( "!=", pseudos );
		} );
	}

	rbuggyQSA = rbuggyQSA.length && new RegExp( rbuggyQSA.join( "|" ) );
	rbuggyMatches = rbuggyMatches.length && new RegExp( rbuggyMatches.join( "|" ) );

	/* Contains
	---------------------------------------------------------------------- */
	hasCompare = rnative.test( docElem.compareDocumentPosition );

	// Element contains another
	// Purposefully self-exclusive
	// As in, an element does not contain itself
	contains = hasCompare || rnative.test( docElem.contains ) ?
		function( a, b ) {
			var adown = a.nodeType === 9 ? a.documentElement : a,
				bup = b && b.parentNode;
			return a === bup || !!( bup && bup.nodeType === 1 && (
				adown.contains ?
					adown.contains( bup ) :
					a.compareDocumentPosition && a.compareDocumentPosition( bup ) & 16
			) );
		} :
		function( a, b ) {
			if ( b ) {
				while ( ( b = b.parentNode ) ) {
					if ( b === a ) {
						return true;
					}
				}
			}
			return false;
		};

	/* Sorting
	---------------------------------------------------------------------- */

	// Document order sorting
	sortOrder = hasCompare ?
	function( a, b ) {

		// Flag for duplicate removal
		if ( a === b ) {
			hasDuplicate = true;
			return 0;
		}

		// Sort on method existence if only one input has compareDocumentPosition
		var compare = !a.compareDocumentPosition - !b.compareDocumentPosition;
		if ( compare ) {
			return compare;
		}

		// Calculate position if both inputs belong to the same document
		// Support: IE 11+, Edge 17 - 18+
		// IE/Edge sometimes throw a "Permission denied" error when strict-comparing
		// two documents; shallow comparisons work.
		// eslint-disable-next-line eqeqeq
		compare = ( a.ownerDocument || a ) == ( b.ownerDocument || b ) ?
			a.compareDocumentPosition( b ) :

			// Otherwise we know they are disconnected
			1;

		// Disconnected nodes
		if ( compare & 1 ||
			( !support.sortDetached && b.compareDocumentPosition( a ) === compare ) ) {

			// Choose the first element that is related to our preferred document
			// Support: IE 11+, Edge 17 - 18+
			// IE/Edge sometimes throw a "Permission denied" error when strict-comparing
			// two documents; shallow comparisons work.
			// eslint-disable-next-line eqeqeq
			if ( a == document || a.ownerDocument == preferredDoc &&
				contains( preferredDoc, a ) ) {
				return -1;
			}

			// Support: IE 11+, Edge 17 - 18+
			// IE/Edge sometimes throw a "Permission denied" error when strict-comparing
			// two documents; shallow comparisons work.
			// eslint-disable-next-line eqeqeq
			if ( b == document || b.ownerDocument == preferredDoc &&
				contains( preferredDoc, b ) ) {
				return 1;
			}

			// Maintain original order
			return sortInput ?
				( indexOf( sortInput, a ) - indexOf( sortInput, b ) ) :
				0;
		}

		return compare & 4 ? -1 : 1;
	} :
	function( a, b ) {

		// Exit early if the nodes are identical
		if ( a === b ) {
			hasDuplicate = true;
			return 0;
		}

		var cur,
			i = 0,
			aup = a.parentNode,
			bup = b.parentNode,
			ap = [ a ],
			bp = [ b ];

		// Parentless nodes are either documents or disconnected
		if ( !aup || !bup ) {

			// Support: IE 11+, Edge 17 - 18+
			// IE/Edge sometimes throw a "Permission denied" error when strict-comparing
			// two documents; shallow comparisons work.
			/* eslint-disable eqeqeq */
			return a == document ? -1 :
				b == document ? 1 :
				/* eslint-enable eqeqeq */
				aup ? -1 :
				bup ? 1 :
				sortInput ?
				( indexOf( sortInput, a ) - indexOf( sortInput, b ) ) :
				0;

		// If the nodes are siblings, we can do a quick check
		} else if ( aup === bup ) {
			return siblingCheck( a, b );
		}

		// Otherwise we need full lists of their ancestors for comparison
		cur = a;
		while ( ( cur = cur.parentNode ) ) {
			ap.unshift( cur );
		}
		cur = b;
		while ( ( cur = cur.parentNode ) ) {
			bp.unshift( cur );
		}

		// Walk down the tree looking for a discrepancy
		while ( ap[ i ] === bp[ i ] ) {
			i++;
		}

		return i ?

			// Do a sibling check if the nodes have a common ancestor
			siblingCheck( ap[ i ], bp[ i ] ) :

			// Otherwise nodes in our document sort first
			// Support: IE 11+, Edge 17 - 18+
			// IE/Edge sometimes throw a "Permission denied" error when strict-comparing
			// two documents; shallow comparisons work.
			/* eslint-disable eqeqeq */
			ap[ i ] == preferredDoc ? -1 :
			bp[ i ] == preferredDoc ? 1 :
			/* eslint-enable eqeqeq */
			0;
	};

	return document;
};

Sizzle.matches = function( expr, elements ) {
	return Sizzle( expr, null, null, elements );
};

Sizzle.matchesSelector = function( elem, expr ) {
	setDocument( elem );

	if ( support.matchesSelector && documentIsHTML &&
		!nonnativeSelectorCache[ expr + " " ] &&
		( !rbuggyMatches || !rbuggyMatches.test( expr ) ) &&
		( !rbuggyQSA     || !rbuggyQSA.test( expr ) ) ) {

		try {
			var ret = matches.call( elem, expr );

			// IE 9's matchesSelector returns false on disconnected nodes
			if ( ret || support.disconnectedMatch ||

				// As well, disconnected nodes are said to be in a document
				// fragment in IE 9
				elem.document && elem.document.nodeType !== 11 ) {
				return ret;
			}
		} catch ( e ) {
			nonnativeSelectorCache( expr, true );
		}
	}

	return Sizzle( expr, document, null, [ elem ] ).length > 0;
};

Sizzle.contains = function( context, elem ) {

	// Set document vars if needed
	// Support: IE 11+, Edge 17 - 18+
	// IE/Edge sometimes throw a "Permission denied" error when strict-comparing
	// two documents; shallow comparisons work.
	// eslint-disable-next-line eqeqeq
	if ( ( context.ownerDocument || context ) != document ) {
		setDocument( context );
	}
	return contains( context, elem );
};

Sizzle.attr = function( elem, name ) {

	// Set document vars if needed
	// Support: IE 11+, Edge 17 - 18+
	// IE/Edge sometimes throw a "Permission denied" error when strict-comparing
	// two documents; shallow comparisons work.
	// eslint-disable-next-line eqeqeq
	if ( ( elem.ownerDocument || elem ) != document ) {
		setDocument( elem );
	}

	var fn = Expr.attrHandle[ name.toLowerCase() ],

		// Don't get fooled by Object.prototype properties (jQuery #13807)
		val = fn && hasOwn.call( Expr.attrHandle, name.toLowerCase() ) ?
			fn( elem, name, !documentIsHTML ) :
			undefined;

	return val !== undefined ?
		val :
		support.attributes || !documentIsHTML ?
			elem.getAttribute( name ) :
			( val = elem.getAttributeNode( name ) ) && val.specified ?
				val.value :
				null;
};

Sizzle.escape = function( sel ) {
	return ( sel + "" ).replace( rcssescape, fcssescape );
};

Sizzle.error = function( msg ) {
	throw new Error( "Syntax error, unrecognized expression: " + msg );
};

/**
 * Document sorting and removing duplicates
 * @param {ArrayLike} results
 */
Sizzle.uniqueSort = function( results ) {
	var elem,
		duplicates = [],
		j = 0,
		i = 0;

	// Unless we *know* we can detect duplicates, assume their presence
	hasDuplicate = !support.detectDuplicates;
	sortInput = !support.sortStable && results.slice( 0 );
	results.sort( sortOrder );

	if ( hasDuplicate ) {
		while ( ( elem = results[ i++ ] ) ) {
			if ( elem === results[ i ] ) {
				j = duplicates.push( i );
			}
		}
		while ( j-- ) {
			results.splice( duplicates[ j ], 1 );
		}
	}

	// Clear input after sorting to release objects
	// See https://github.com/jquery/sizzle/pull/225
	sortInput = null;

	return results;
};

/**
 * Utility function for retrieving the text value of an array of DOM nodes
 * @param {Array|Element} elem
 */
getText = Sizzle.getText = function( elem ) {
	var node,
		ret = "",
		i = 0,
		nodeType = elem.nodeType;

	if ( !nodeType ) {

		// If no nodeType, this is expected to be an array
		while ( ( node = elem[ i++ ] ) ) {

			// Do not traverse comment nodes
			ret += getText( node );
		}
	} else if ( nodeType === 1 || nodeType === 9 || nodeType === 11 ) {

		// Use textContent for elements
		// innerText usage removed for consistency of new lines (jQuery #11153)
		if ( typeof elem.textContent === "string" ) {
			return elem.textContent;
		} else {

			// Traverse its children
			for ( elem = elem.firstChild; elem; elem = elem.nextSibling ) {
				ret += getText( elem );
			}
		}
	} else if ( nodeType === 3 || nodeType === 4 ) {
		return elem.nodeValue;
	}

	// Do not include comment or processing instruction nodes

	return ret;
};

Expr = Sizzle.selectors = {

	// Can be adjusted by the user
	cacheLength: 50,

	createPseudo: markFunction,

	match: matchExpr,

	attrHandle: {},

	find: {},

	relative: {
		">": { dir: "parentNode", first: true },
		" ": { dir: "parentNode" },
		"+": { dir: "previousSibling", first: true },
		"~": { dir: "previousSibling" }
	},

	preFilter: {
		"ATTR": function( match ) {
			match[ 1 ] = match[ 1 ].replace( runescape, funescape );

			// Move the given value to match[3] whether quoted or unquoted
			match[ 3 ] = ( match[ 3 ] || match[ 4 ] ||
				match[ 5 ] || "" ).replace( runescape, funescape );

			if ( match[ 2 ] === "~=" ) {
				match[ 3 ] = " " + match[ 3 ] + " ";
			}

			return match.slice( 0, 4 );
		},

		"CHILD": function( match ) {

			/* matches from matchExpr["CHILD"]
				1 type (only|nth|...)
				2 what (child|of-type)
				3 argument (even|odd|\d*|\d*n([+-]\d+)?|...)
				4 xn-component of xn+y argument ([+-]?\d*n|)
				5 sign of xn-component
				6 x of xn-component
				7 sign of y-component
				8 y of y-component
			*/
			match[ 1 ] = match[ 1 ].toLowerCase();

			if ( match[ 1 ].slice( 0, 3 ) === "nth" ) {

				// nth-* requires argument
				if ( !match[ 3 ] ) {
					Sizzle.error( match[ 0 ] );
				}

				// numeric x and y parameters for Expr.filter.CHILD
				// remember that false/true cast respectively to 0/1
				match[ 4 ] = +( match[ 4 ] ?
					match[ 5 ] + ( match[ 6 ] || 1 ) :
					2 * ( match[ 3 ] === "even" || match[ 3 ] === "odd" ) );
				match[ 5 ] = +( ( match[ 7 ] + match[ 8 ] ) || match[ 3 ] === "odd" );

				// other types prohibit arguments
			} else if ( match[ 3 ] ) {
				Sizzle.error( match[ 0 ] );
			}

			return match;
		},

		"PSEUDO": function( match ) {
			var excess,
				unquoted = !match[ 6 ] && match[ 2 ];

			if ( matchExpr[ "CHILD" ].test( match[ 0 ] ) ) {
				return null;
			}

			// Accept quoted arguments as-is
			if ( match[ 3 ] ) {
				match[ 2 ] = match[ 4 ] || match[ 5 ] || "";

			// Strip excess characters from unquoted arguments
			} else if ( unquoted && rpseudo.test( unquoted ) &&

				// Get excess from tokenize (recursively)
				( excess = tokenize( unquoted, true ) ) &&

				// advance to the next closing parenthesis
				( excess = unquoted.indexOf( ")", unquoted.length - excess ) - unquoted.length ) ) {

				// excess is a negative index
				match[ 0 ] = match[ 0 ].slice( 0, excess );
				match[ 2 ] = unquoted.slice( 0, excess );
			}

			// Return only captures needed by the pseudo filter method (type and argument)
			return match.slice( 0, 3 );
		}
	},

	filter: {

		"TAG": function( nodeNameSelector ) {
			var nodeName = nodeNameSelector.replace( runescape, funescape ).toLowerCase();
			return nodeNameSelector === "*" ?
				function() {
					return true;
				} :
				function( elem ) {
					return elem.nodeName && elem.nodeName.toLowerCase() === nodeName;
				};
		},

		"CLASS": function( className ) {
			var pattern = classCache[ className + " " ];

			return pattern ||
				( pattern = new RegExp( "(^|" + whitespace +
					")" + className + "(" + whitespace + "|$)" ) ) && classCache(
						className, function( elem ) {
							return pattern.test(
								typeof elem.className === "string" && elem.className ||
								typeof elem.getAttribute !== "undefined" &&
									elem.getAttribute( "class" ) ||
								""
							);
				} );
		},

		"ATTR": function( name, operator, check ) {
			return function( elem ) {
				var result = Sizzle.attr( elem, name );

				if ( result == null ) {
					return operator === "!=";
				}
				if ( !operator ) {
					return true;
				}

				result += "";

				/* eslint-disable max-len */

				return operator === "=" ? result === check :
					operator === "!=" ? result !== check :
					operator === "^=" ? check && result.indexOf( check ) === 0 :
					operator === "*=" ? check && result.indexOf( check ) > -1 :
					operator === "$=" ? check && result.slice( -check.length ) === check :
					operator === "~=" ? ( " " + result.replace( rwhitespace, " " ) + " " ).indexOf( check ) > -1 :
					operator === "|=" ? result === check || result.slice( 0, check.length + 1 ) === check + "-" :
					false;
				/* eslint-enable max-len */

			};
		},

		"CHILD": function( type, what, _argument, first, last ) {
			var simple = type.slice( 0, 3 ) !== "nth",
				forward = type.slice( -4 ) !== "last",
				ofType = what === "of-type";

			return first === 1 && last === 0 ?

				// Shortcut for :nth-*(n)
				function( elem ) {
					return !!elem.parentNode;
				} :

				function( elem, _context, xml ) {
					var cache, uniqueCache, outerCache, node, nodeIndex, start,
						dir = simple !== forward ? "nextSibling" : "previousSibling",
						parent = elem.parentNode,
						name = ofType && elem.nodeName.toLowerCase(),
						useCache = !xml && !ofType,
						diff = false;

					if ( parent ) {

						// :(first|last|only)-(child|of-type)
						if ( simple ) {
							while ( dir ) {
								node = elem;
								while ( ( node = node[ dir ] ) ) {
									if ( ofType ?
										node.nodeName.toLowerCase() === name :
										node.nodeType === 1 ) {

										return false;
									}
								}

								// Reverse direction for :only-* (if we haven't yet done so)
								start = dir = type === "only" && !start && "nextSibling";
							}
							return true;
						}

						start = [ forward ? parent.firstChild : parent.lastChild ];

						// non-xml :nth-child(...) stores cache data on `parent`
						if ( forward && useCache ) {

							// Seek `elem` from a previously-cached index

							// ...in a gzip-friendly way
							node = parent;
							outerCache = node[ expando ] || ( node[ expando ] = {} );

							// Support: IE <9 only
							// Defend against cloned attroperties (jQuery gh-1709)
							uniqueCache = outerCache[ node.uniqueID ] ||
								( outerCache[ node.uniqueID ] = {} );

							cache = uniqueCache[ type ] || [];
							nodeIndex = cache[ 0 ] === dirruns && cache[ 1 ];
							diff = nodeIndex && cache[ 2 ];
							node = nodeIndex && parent.childNodes[ nodeIndex ];

							while ( ( node = ++nodeIndex && node && node[ dir ] ||

								// Fallback to seeking `elem` from the start
								( diff = nodeIndex = 0 ) || start.pop() ) ) {

								// When found, cache indexes on `parent` and break
								if ( node.nodeType === 1 && ++diff && node === elem ) {
									uniqueCache[ type ] = [ dirruns, nodeIndex, diff ];
									break;
								}
							}

						} else {

							// Use previously-cached element index if available
							if ( useCache ) {

								// ...in a gzip-friendly way
								node = elem;
								outerCache = node[ expando ] || ( node[ expando ] = {} );

								// Support: IE <9 only
								// Defend against cloned attroperties (jQuery gh-1709)
								uniqueCache = outerCache[ node.uniqueID ] ||
									( outerCache[ node.uniqueID ] = {} );

								cache = uniqueCache[ type ] || [];
								nodeIndex = cache[ 0 ] === dirruns && cache[ 1 ];
								diff = nodeIndex;
							}

							// xml :nth-child(...)
							// or :nth-last-child(...) or :nth(-last)?-of-type(...)
							if ( diff === false ) {

								// Use the same loop as above to seek `elem` from the start
								while ( ( node = ++nodeIndex && node && node[ dir ] ||
									( diff = nodeIndex = 0 ) || start.pop() ) ) {

									if ( ( ofType ?
										node.nodeName.toLowerCase() === name :
										node.nodeType === 1 ) &&
										++diff ) {

										// Cache the index of each encountered element
										if ( useCache ) {
											outerCache = node[ expando ] ||
												( node[ expando ] = {} );

											// Support: IE <9 only
											// Defend against cloned attroperties (jQuery gh-1709)
											uniqueCache = outerCache[ node.uniqueID ] ||
												( outerCache[ node.uniqueID ] = {} );

											uniqueCache[ type ] = [ dirruns, diff ];
										}

										if ( node === elem ) {
											break;
										}
									}
								}
							}
						}

						// Incorporate the offset, then check against cycle size
						diff -= last;
						return diff === first || ( diff % first === 0 && diff / first >= 0 );
					}
				};
		},

		"PSEUDO": function( pseudo, argument ) {

			// pseudo-class names are case-insensitive
			// http://www.w3.org/TR/selectors/#pseudo-classes
			// Prioritize by case sensitivity in case custom pseudos are added with uppercase letters
			// Remember that setFilters inherits from pseudos
			var args,
				fn = Expr.pseudos[ pseudo ] || Expr.setFilters[ pseudo.toLowerCase() ] ||
					Sizzle.error( "unsupported pseudo: " + pseudo );

			// The user may use createPseudo to indicate that
			// arguments are needed to create the filter function
			// just as Sizzle does
			if ( fn[ expando ] ) {
				return fn( argument );
			}

			// But maintain support for old signatures
			if ( fn.length > 1 ) {
				args = [ pseudo, pseudo, "", argument ];
				return Expr.setFilters.hasOwnProperty( pseudo.toLowerCase() ) ?
					markFunction( function( seed, matches ) {
						var idx,
							matched = fn( seed, argument ),
							i = matched.length;
						while ( i-- ) {
							idx = indexOf( seed, matched[ i ] );
							seed[ idx ] = !( matches[ idx ] = matched[ i ] );
						}
					} ) :
					function( elem ) {
						return fn( elem, 0, args );
					};
			}

			return fn;
		}
	},

	pseudos: {

		// Potentially complex pseudos
		"not": markFunction( function( selector ) {

			// Trim the selector passed to compile
			// to avoid treating leading and trailing
			// spaces as combinators
			var input = [],
				results = [],
				matcher = compile( selector.replace( rtrim, "$1" ) );

			return matcher[ expando ] ?
				markFunction( function( seed, matches, _context, xml ) {
					var elem,
						unmatched = matcher( seed, null, xml, [] ),
						i = seed.length;

					// Match elements unmatched by `matcher`
					while ( i-- ) {
						if ( ( elem = unmatched[ i ] ) ) {
							seed[ i ] = !( matches[ i ] = elem );
						}
					}
				} ) :
				function( elem, _context, xml ) {
					input[ 0 ] = elem;
					matcher( input, null, xml, results );

					// Don't keep the element (issue #299)
					input[ 0 ] = null;
					return !results.pop();
				};
		} ),

		"has": markFunction( function( selector ) {
			return function( elem ) {
				return Sizzle( selector, elem ).length > 0;
			};
		} ),

		"contains": markFunction( function( text ) {
			text = text.replace( runescape, funescape );
			return function( elem ) {
				return ( elem.textContent || getText( elem ) ).indexOf( text ) > -1;
			};
		} ),

		// "Whether an element is represented by a :lang() selector
		// is based solely on the element's language value
		// being equal to the identifier C,
		// or beginning with the identifier C immediately followed by "-".
		// The matching of C against the element's language value is performed case-insensitively.
		// The identifier C does not have to be a valid language name."
		// http://www.w3.org/TR/selectors/#lang-pseudo
		"lang": markFunction( function( lang ) {

			// lang value must be a valid identifier
			if ( !ridentifier.test( lang || "" ) ) {
				Sizzle.error( "unsupported lang: " + lang );
			}
			lang = lang.replace( runescape, funescape ).toLowerCase();
			return function( elem ) {
				var elemLang;
				do {
					if ( ( elemLang = documentIsHTML ?
						elem.lang :
						elem.getAttribute( "xml:lang" ) || elem.getAttribute( "lang" ) ) ) {

						elemLang = elemLang.toLowerCase();
						return elemLang === lang || elemLang.indexOf( lang + "-" ) === 0;
					}
				} while ( ( elem = elem.parentNode ) && elem.nodeType === 1 );
				return false;
			};
		} ),

		// Miscellaneous
		"target": function( elem ) {
			var hash = window.location && window.location.hash;
			return hash && hash.slice( 1 ) === elem.id;
		},

		"root": function( elem ) {
			return elem === docElem;
		},

		"focus": function( elem ) {
			return elem === document.activeElement &&
				( !document.hasFocus || document.hasFocus() ) &&
				!!( elem.type || elem.href || ~elem.tabIndex );
		},

		// Boolean properties
		"enabled": createDisabledPseudo( false ),
		"disabled": createDisabledPseudo( true ),

		"checked": function( elem ) {

			// In CSS3, :checked should return both checked and selected elements
			// http://www.w3.org/TR/2011/REC-css3-selectors-20110929/#checked
			var nodeName = elem.nodeName.toLowerCase();
			return ( nodeName === "input" && !!elem.checked ) ||
				( nodeName === "option" && !!elem.selected );
		},

		"selected": function( elem ) {

			// Accessing this property makes selected-by-default
			// options in Safari work properly
			if ( elem.parentNode ) {
				// eslint-disable-next-line no-unused-expressions
				elem.parentNode.selectedIndex;
			}

			return elem.selected === true;
		},

		// Contents
		"empty": function( elem ) {

			// http://www.w3.org/TR/selectors/#empty-pseudo
			// :empty is negated by element (1) or content nodes (text: 3; cdata: 4; entity ref: 5),
			//   but not by others (comment: 8; processing instruction: 7; etc.)
			// nodeType < 6 works because attributes (2) do not appear as children
			for ( elem = elem.firstChild; elem; elem = elem.nextSibling ) {
				if ( elem.nodeType < 6 ) {
					return false;
				}
			}
			return true;
		},

		"parent": function( elem ) {
			return !Expr.pseudos[ "empty" ]( elem );
		},

		// Element/input types
		"header": function( elem ) {
			return rheader.test( elem.nodeName );
		},

		"input": function( elem ) {
			return rinputs.test( elem.nodeName );
		},

		"button": function( elem ) {
			var name = elem.nodeName.toLowerCase();
			return name === "input" && elem.type === "button" || name === "button";
		},

		"text": function( elem ) {
			var attr;
			return elem.nodeName.toLowerCase() === "input" &&
				elem.type === "text" &&

				// Support: IE<8
				// New HTML5 attribute values (e.g., "search") appear with elem.type === "text"
				( ( attr = elem.getAttribute( "type" ) ) == null ||
					attr.toLowerCase() === "text" );
		},

		// Position-in-collection
		"first": createPositionalPseudo( function() {
			return [ 0 ];
		} ),

		"last": createPositionalPseudo( function( _matchIndexes, length ) {
			return [ length - 1 ];
		} ),

		"eq": createPositionalPseudo( function( _matchIndexes, length, argument ) {
			return [ argument < 0 ? argument + length : argument ];
		} ),

		"even": createPositionalPseudo( function( matchIndexes, length ) {
			var i = 0;
			for ( ; i < length; i += 2 ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		} ),

		"odd": createPositionalPseudo( function( matchIndexes, length ) {
			var i = 1;
			for ( ; i < length; i += 2 ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		} ),

		"lt": createPositionalPseudo( function( matchIndexes, length, argument ) {
			var i = argument < 0 ?
				argument + length :
				argument > length ?
					length :
					argument;
			for ( ; --i >= 0; ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		} ),

		"gt": createPositionalPseudo( function( matchIndexes, length, argument ) {
			var i = argument < 0 ? argument + length : argument;
			for ( ; ++i < length; ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		} )
	}
};

Expr.pseudos[ "nth" ] = Expr.pseudos[ "eq" ];

// Add button/input type pseudos
for ( i in { radio: true, checkbox: true, file: true, password: true, image: true } ) {
	Expr.pseudos[ i ] = createInputPseudo( i );
}
for ( i in { submit: true, reset: true } ) {
	Expr.pseudos[ i ] = createButtonPseudo( i );
}

// Easy API for creating new setFilters
function setFilters() {}
setFilters.prototype = Expr.filters = Expr.pseudos;
Expr.setFilters = new setFilters();

tokenize = Sizzle.tokenize = function( selector, parseOnly ) {
	var matched, match, tokens, type,
		soFar, groups, preFilters,
		cached = tokenCache[ selector + " " ];

	if ( cached ) {
		return parseOnly ? 0 : cached.slice( 0 );
	}

	soFar = selector;
	groups = [];
	preFilters = Expr.preFilter;

	while ( soFar ) {

		// Comma and first run
		if ( !matched || ( match = rcomma.exec( soFar ) ) ) {
			if ( match ) {

				// Don't consume trailing commas as valid
				soFar = soFar.slice( match[ 0 ].length ) || soFar;
			}
			groups.push( ( tokens = [] ) );
		}

		matched = false;

		// Combinators
		if ( ( match = rcombinators.exec( soFar ) ) ) {
			matched = match.shift();
			tokens.push( {
				value: matched,

				// Cast descendant combinators to space
				type: match[ 0 ].replace( rtrim, " " )
			} );
			soFar = soFar.slice( matched.length );
		}

		// Filters
		for ( type in Expr.filter ) {
			if ( ( match = matchExpr[ type ].exec( soFar ) ) && ( !preFilters[ type ] ||
				( match = preFilters[ type ]( match ) ) ) ) {
				matched = match.shift();
				tokens.push( {
					value: matched,
					type: type,
					matches: match
				} );
				soFar = soFar.slice( matched.length );
			}
		}

		if ( !matched ) {
			break;
		}
	}

	// Return the length of the invalid excess
	// if we're just parsing
	// Otherwise, throw an error or return tokens
	return parseOnly ?
		soFar.length :
		soFar ?
			Sizzle.error( selector ) :

			// Cache the tokens
			tokenCache( selector, groups ).slice( 0 );
};

function toSelector( tokens ) {
	var i = 0,
		len = tokens.length,
		selector = "";
	for ( ; i < len; i++ ) {
		selector += tokens[ i ].value;
	}
	return selector;
}

function addCombinator( matcher, combinator, base ) {
	var dir = combinator.dir,
		skip = combinator.next,
		key = skip || dir,
		checkNonElements = base && key === "parentNode",
		doneName = done++;

	return combinator.first ?

		// Check against closest ancestor/preceding element
		function( elem, context, xml ) {
			while ( ( elem = elem[ dir ] ) ) {
				if ( elem.nodeType === 1 || checkNonElements ) {
					return matcher( elem, context, xml );
				}
			}
			return false;
		} :

		// Check against all ancestor/preceding elements
		function( elem, context, xml ) {
			var oldCache, uniqueCache, outerCache,
				newCache = [ dirruns, doneName ];

			// We can't set arbitrary data on XML nodes, so they don't benefit from combinator caching
			if ( xml ) {
				while ( ( elem = elem[ dir ] ) ) {
					if ( elem.nodeType === 1 || checkNonElements ) {
						if ( matcher( elem, context, xml ) ) {
							return true;
						}
					}
				}
			} else {
				while ( ( elem = elem[ dir ] ) ) {
					if ( elem.nodeType === 1 || checkNonElements ) {
						outerCache = elem[ expando ] || ( elem[ expando ] = {} );

						// Support: IE <9 only
						// Defend against cloned attroperties (jQuery gh-1709)
						uniqueCache = outerCache[ elem.uniqueID ] ||
							( outerCache[ elem.uniqueID ] = {} );

						if ( skip && skip === elem.nodeName.toLowerCase() ) {
							elem = elem[ dir ] || elem;
						} else if ( ( oldCache = uniqueCache[ key ] ) &&
							oldCache[ 0 ] === dirruns && oldCache[ 1 ] === doneName ) {

							// Assign to newCache so results back-propagate to previous elements
							return ( newCache[ 2 ] = oldCache[ 2 ] );
						} else {

							// Reuse newcache so results back-propagate to previous elements
							uniqueCache[ key ] = newCache;

							// A match means we're done; a fail means we have to keep checking
							if ( ( newCache[ 2 ] = matcher( elem, context, xml ) ) ) {
								return true;
							}
						}
					}
				}
			}
			return false;
		};
}

function elementMatcher( matchers ) {
	return matchers.length > 1 ?
		function( elem, context, xml ) {
			var i = matchers.length;
			while ( i-- ) {
				if ( !matchers[ i ]( elem, context, xml ) ) {
					return false;
				}
			}
			return true;
		} :
		matchers[ 0 ];
}

function multipleContexts( selector, contexts, results ) {
	var i = 0,
		len = contexts.length;
	for ( ; i < len; i++ ) {
		Sizzle( selector, contexts[ i ], results );
	}
	return results;
}

function condense( unmatched, map, filter, context, xml ) {
	var elem,
		newUnmatched = [],
		i = 0,
		len = unmatched.length,
		mapped = map != null;

	for ( ; i < len; i++ ) {
		if ( ( elem = unmatched[ i ] ) ) {
			if ( !filter || filter( elem, context, xml ) ) {
				newUnmatched.push( elem );
				if ( mapped ) {
					map.push( i );
				}
			}
		}
	}

	return newUnmatched;
}

function setMatcher( preFilter, selector, matcher, postFilter, postFinder, postSelector ) {
	if ( postFilter && !postFilter[ expando ] ) {
		postFilter = setMatcher( postFilter );
	}
	if ( postFinder && !postFinder[ expando ] ) {
		postFinder = setMatcher( postFinder, postSelector );
	}
	return markFunction( function( seed, results, context, xml ) {
		var temp, i, elem,
			preMap = [],
			postMap = [],
			preexisting = results.length,

			// Get initial elements from seed or context
			elems = seed || multipleContexts(
				selector || "*",
				context.nodeType ? [ context ] : context,
				[]
			),

			// Prefilter to get matcher input, preserving a map for seed-results synchronization
			matcherIn = preFilter && ( seed || !selector ) ?
				condense( elems, preMap, preFilter, context, xml ) :
				elems,

			matcherOut = matcher ?

				// If we have a postFinder, or filtered seed, or non-seed postFilter or preexisting results,
				postFinder || ( seed ? preFilter : preexisting || postFilter ) ?

					// ...intermediate processing is necessary
					[] :

					// ...otherwise use results directly
					results :
				matcherIn;

		// Find primary matches
		if ( matcher ) {
			matcher( matcherIn, matcherOut, context, xml );
		}

		// Apply postFilter
		if ( postFilter ) {
			temp = condense( matcherOut, postMap );
			postFilter( temp, [], context, xml );

			// Un-match failing elements by moving them back to matcherIn
			i = temp.length;
			while ( i-- ) {
				if ( ( elem = temp[ i ] ) ) {
					matcherOut[ postMap[ i ] ] = !( matcherIn[ postMap[ i ] ] = elem );
				}
			}
		}

		if ( seed ) {
			if ( postFinder || preFilter ) {
				if ( postFinder ) {

					// Get the final matcherOut by condensing this intermediate into postFinder contexts
					temp = [];
					i = matcherOut.length;
					while ( i-- ) {
						if ( ( elem = matcherOut[ i ] ) ) {

							// Restore matcherIn since elem is not yet a final match
							temp.push( ( matcherIn[ i ] = elem ) );
						}
					}
					postFinder( null, ( matcherOut = [] ), temp, xml );
				}

				// Move matched elements from seed to results to keep them synchronized
				i = matcherOut.length;
				while ( i-- ) {
					if ( ( elem = matcherOut[ i ] ) &&
						( temp = postFinder ? indexOf( seed, elem ) : preMap[ i ] ) > -1 ) {

						seed[ temp ] = !( results[ temp ] = elem );
					}
				}
			}

		// Add elements to results, through postFinder if defined
		} else {
			matcherOut = condense(
				matcherOut === results ?
					matcherOut.splice( preexisting, matcherOut.length ) :
					matcherOut
			);
			if ( postFinder ) {
				postFinder( null, results, matcherOut, xml );
			} else {
				push.apply( results, matcherOut );
			}
		}
	} );
}

function matcherFromTokens( tokens ) {
	var checkContext, matcher, j,
		len = tokens.length,
		leadingRelative = Expr.relative[ tokens[ 0 ].type ],
		implicitRelative = leadingRelative || Expr.relative[ " " ],
		i = leadingRelative ? 1 : 0,

		// The foundational matcher ensures that elements are reachable from top-level context(s)
		matchContext = addCombinator( function( elem ) {
			return elem === checkContext;
		}, implicitRelative, true ),
		matchAnyContext = addCombinator( function( elem ) {
			return indexOf( checkContext, elem ) > -1;
		}, implicitRelative, true ),
		matchers = [ function( elem, context, xml ) {
			var ret = ( !leadingRelative && ( xml || context !== outermostContext ) ) || (
				( checkContext = context ).nodeType ?
					matchContext( elem, context, xml ) :
					matchAnyContext( elem, context, xml ) );

			// Avoid hanging onto element (issue #299)
			checkContext = null;
			return ret;
		} ];

	for ( ; i < len; i++ ) {
		if ( ( matcher = Expr.relative[ tokens[ i ].type ] ) ) {
			matchers = [ addCombinator( elementMatcher( matchers ), matcher ) ];
		} else {
			matcher = Expr.filter[ tokens[ i ].type ].apply( null, tokens[ i ].matches );

			// Return special upon seeing a positional matcher
			if ( matcher[ expando ] ) {

				// Find the next relative operator (if any) for proper handling
				j = ++i;
				for ( ; j < len; j++ ) {
					if ( Expr.relative[ tokens[ j ].type ] ) {
						break;
					}
				}
				return setMatcher(
					i > 1 && elementMatcher( matchers ),
					i > 1 && toSelector(

					// If the preceding token was a descendant combinator, insert an implicit any-element `*`
					tokens
						.slice( 0, i - 1 )
						.concat( { value: tokens[ i - 2 ].type === " " ? "*" : "" } )
					).replace( rtrim, "$1" ),
					matcher,
					i < j && matcherFromTokens( tokens.slice( i, j ) ),
					j < len && matcherFromTokens( ( tokens = tokens.slice( j ) ) ),
					j < len && toSelector( tokens )
				);
			}
			matchers.push( matcher );
		}
	}

	return elementMatcher( matchers );
}

function matcherFromGroupMatchers( elementMatchers, setMatchers ) {
	var bySet = setMatchers.length > 0,
		byElement = elementMatchers.length > 0,
		superMatcher = function( seed, context, xml, results, outermost ) {
			var elem, j, matcher,
				matchedCount = 0,
				i = "0",
				unmatched = seed && [],
				setMatched = [],
				contextBackup = outermostContext,

				// We must always have either seed elements or outermost context
				elems = seed || byElement && Expr.find[ "TAG" ]( "*", outermost ),

				// Use integer dirruns iff this is the outermost matcher
				dirrunsUnique = ( dirruns += contextBackup == null ? 1 : Math.random() || 0.1 ),
				len = elems.length;

			if ( outermost ) {

				// Support: IE 11+, Edge 17 - 18+
				// IE/Edge sometimes throw a "Permission denied" error when strict-comparing
				// two documents; shallow comparisons work.
				// eslint-disable-next-line eqeqeq
				outermostContext = context == document || context || outermost;
			}

			// Add elements passing elementMatchers directly to results
			// Support: IE<9, Safari
			// Tolerate NodeList properties (IE: "length"; Safari: <number>) matching elements by id
			for ( ; i !== len && ( elem = elems[ i ] ) != null; i++ ) {
				if ( byElement && elem ) {
					j = 0;

					// Support: IE 11+, Edge 17 - 18+
					// IE/Edge sometimes throw a "Permission denied" error when strict-comparing
					// two documents; shallow comparisons work.
					// eslint-disable-next-line eqeqeq
					if ( !context && elem.ownerDocument != document ) {
						setDocument( elem );
						xml = !documentIsHTML;
					}
					while ( ( matcher = elementMatchers[ j++ ] ) ) {
						if ( matcher( elem, context || document, xml ) ) {
							results.push( elem );
							break;
						}
					}
					if ( outermost ) {
						dirruns = dirrunsUnique;
					}
				}

				// Track unmatched elements for set filters
				if ( bySet ) {

					// They will have gone through all possible matchers
					if ( ( elem = !matcher && elem ) ) {
						matchedCount--;
					}

					// Lengthen the array for every element, matched or not
					if ( seed ) {
						unmatched.push( elem );
					}
				}
			}

			// `i` is now the count of elements visited above, and adding it to `matchedCount`
			// makes the latter nonnegative.
			matchedCount += i;

			// Apply set filters to unmatched elements
			// NOTE: This can be skipped if there are no unmatched elements (i.e., `matchedCount`
			// equals `i`), unless we didn't visit _any_ elements in the above loop because we have
			// no element matchers and no seed.
			// Incrementing an initially-string "0" `i` allows `i` to remain a string only in that
			// case, which will result in a "00" `matchedCount` that differs from `i` but is also
			// numerically zero.
			if ( bySet && i !== matchedCount ) {
				j = 0;
				while ( ( matcher = setMatchers[ j++ ] ) ) {
					matcher( unmatched, setMatched, context, xml );
				}

				if ( seed ) {

					// Reintegrate element matches to eliminate the need for sorting
					if ( matchedCount > 0 ) {
						while ( i-- ) {
							if ( !( unmatched[ i ] || setMatched[ i ] ) ) {
								setMatched[ i ] = pop.call( results );
							}
						}
					}

					// Discard index placeholder values to get only actual matches
					setMatched = condense( setMatched );
				}

				// Add matches to results
				push.apply( results, setMatched );

				// Seedless set matches succeeding multiple successful matchers stipulate sorting
				if ( outermost && !seed && setMatched.length > 0 &&
					( matchedCount + setMatchers.length ) > 1 ) {

					Sizzle.uniqueSort( results );
				}
			}

			// Override manipulation of globals by nested matchers
			if ( outermost ) {
				dirruns = dirrunsUnique;
				outermostContext = contextBackup;
			}

			return unmatched;
		};

	return bySet ?
		markFunction( superMatcher ) :
		superMatcher;
}

compile = Sizzle.compile = function( selector, match /* Internal Use Only */ ) {
	var i,
		setMatchers = [],
		elementMatchers = [],
		cached = compilerCache[ selector + " " ];

	if ( !cached ) {

		// Generate a function of recursive functions that can be used to check each element
		if ( !match ) {
			match = tokenize( selector );
		}
		i = match.length;
		while ( i-- ) {
			cached = matcherFromTokens( match[ i ] );
			if ( cached[ expando ] ) {
				setMatchers.push( cached );
			} else {
				elementMatchers.push( cached );
			}
		}

		// Cache the compiled function
		cached = compilerCache(
			selector,
			matcherFromGroupMatchers( elementMatchers, setMatchers )
		);

		// Save selector and tokenization
		cached.selector = selector;
	}
	return cached;
};

/**
 * A low-level selection function that works with Sizzle's compiled
 *  selector functions
 * @param {String|Function} selector A selector or a pre-compiled
 *  selector function built with Sizzle.compile
 * @param {Element} context
 * @param {Array} [results]
 * @param {Array} [seed] A set of elements to match against
 */
select = Sizzle.select = function( selector, context, results, seed ) {
	var i, tokens, token, type, find,
		compiled = typeof selector === "function" && selector,
		match = !seed && tokenize( ( selector = compiled.selector || selector ) );

	results = results || [];

	// Try to minimize operations if there is only one selector in the list and no seed
	// (the latter of which guarantees us context)
	if ( match.length === 1 ) {

		// Reduce context if the leading compound selector is an ID
		tokens = match[ 0 ] = match[ 0 ].slice( 0 );
		if ( tokens.length > 2 && ( token = tokens[ 0 ] ).type === "ID" &&
			context.nodeType === 9 && documentIsHTML && Expr.relative[ tokens[ 1 ].type ] ) {

			context = ( Expr.find[ "ID" ]( token.matches[ 0 ]
				.replace( runescape, funescape ), context ) || [] )[ 0 ];
			if ( !context ) {
				return results;

			// Precompiled matchers will still verify ancestry, so step up a level
			} else if ( compiled ) {
				context = context.parentNode;
			}

			selector = selector.slice( tokens.shift().value.length );
		}

		// Fetch a seed set for right-to-left matching
		i = matchExpr[ "needsContext" ].test( selector ) ? 0 : tokens.length;
		while ( i-- ) {
			token = tokens[ i ];

			// Abort if we hit a combinator
			if ( Expr.relative[ ( type = token.type ) ] ) {
				break;
			}
			if ( ( find = Expr.find[ type ] ) ) {

				// Search, expanding context for leading sibling combinators
				if ( ( seed = find(
					token.matches[ 0 ].replace( runescape, funescape ),
					rsibling.test( tokens[ 0 ].type ) && testContext( context.parentNode ) ||
						context
				) ) ) {

					// If seed is empty or no tokens remain, we can return early
					tokens.splice( i, 1 );
					selector = seed.length && toSelector( tokens );
					if ( !selector ) {
						push.apply( results, seed );
						return results;
					}

					break;
				}
			}
		}
	}

	// Compile and execute a filtering function if one is not provided
	// Provide `match` to avoid retokenization if we modified the selector above
	( compiled || compile( selector, match ) )(
		seed,
		context,
		!documentIsHTML,
		results,
		!context || rsibling.test( selector ) && testContext( context.parentNode ) || context
	);
	return results;
};

// One-time assignments

// Sort stability
support.sortStable = expando.split( "" ).sort( sortOrder ).join( "" ) === expando;

// Support: Chrome 14-35+
// Always assume duplicates if they aren't passed to the comparison function
support.detectDuplicates = !!hasDuplicate;

// Initialize against the default document
setDocument();

// Support: Webkit<537.32 - Safari 6.0.3/Chrome 25 (fixed in Chrome 27)
// Detached nodes confoundingly follow *each other*
support.sortDetached = assert( function( el ) {

	// Should return 1, but returns 4 (following)
	return el.compareDocumentPosition( document.createElement( "fieldset" ) ) & 1;
} );

// Support: IE<8
// Prevent attribute/property "interpolation"
// https://msdn.microsoft.com/en-us/library/ms536429%28VS.85%29.aspx
if ( !assert( function( el ) {
	el.innerHTML = "<a href='#'></a>";
	return el.firstChild.getAttribute( "href" ) === "#";
} ) ) {
	addHandle( "type|href|height|width", function( elem, name, isXML ) {
		if ( !isXML ) {
			return elem.getAttribute( name, name.toLowerCase() === "type" ? 1 : 2 );
		}
	} );
}

// Support: IE<9
// Use defaultValue in place of getAttribute("value")
if ( !support.attributes || !assert( function( el ) {
	el.innerHTML = "<input/>";
	el.firstChild.setAttribute( "value", "" );
	return el.firstChild.getAttribute( "value" ) === "";
} ) ) {
	addHandle( "value", function( elem, _name, isXML ) {
		if ( !isXML && elem.nodeName.toLowerCase() === "input" ) {
			return elem.defaultValue;
		}
	} );
}

// Support: IE<9
// Use getAttributeNode to fetch booleans when getAttribute lies
if ( !assert( function( el ) {
	return el.getAttribute( "disabled" ) == null;
} ) ) {
	addHandle( booleans, function( elem, name, isXML ) {
		var val;
		if ( !isXML ) {
			return elem[ name ] === true ? name.toLowerCase() :
				( val = elem.getAttributeNode( name ) ) && val.specified ?
					val.value :
					null;
		}
	} );
}

return Sizzle;

} )( window );



jQuery.find = Sizzle;
jQuery.expr = Sizzle.selectors;

// Deprecated
jQuery.expr[ ":" ] = jQuery.expr.pseudos;
jQuery.uniqueSort = jQuery.unique = Sizzle.uniqueSort;
jQuery.text = Sizzle.getText;
jQuery.isXMLDoc = Sizzle.isXML;
jQuery.contains = Sizzle.contains;
jQuery.escapeSelector = Sizzle.escape;




var dir = function( elem, dir, until ) {
	var matched = [],
		truncate = until !== undefined;

	while ( ( elem = elem[ dir ] ) && elem.nodeType !== 9 ) {
		if ( elem.nodeType === 1 ) {
			if ( truncate && jQuery( elem ).is( until ) ) {
				break;
			}
			matched.push( elem );
		}
	}
	return matched;
};


var siblings = function( n, elem ) {
	var matched = [];

	for ( ; n; n = n.nextSibling ) {
		if ( n.nodeType === 1 && n !== elem ) {
			matched.push( n );
		}
	}

	return matched;
};


var rneedsContext = jQuery.expr.match.needsContext;



function nodeName( elem, name ) {

  return elem.nodeName && elem.nodeName.toLowerCase() === name.toLowerCase();

}var rsingleTag = ( /^<([a-z][^\/\0>:\x20\t\r\n\f]*)[\x20\t\r\n\f]*\/?>(?:<\/\1>|)$/i );



// Implement the identical functionality for filter and not
function winnow( elements, qualifier, not ) {
	if ( isFunction( qualifier ) ) {
		return jQuery.grep( elements, function( elem, i ) {
			return !!qualifier.call( elem, i, elem ) !== not;
		} );
	}

	// Single element
	if ( qualifier.nodeType ) {
		return jQuery.grep( elements, function( elem ) {
			return ( elem === qualifier ) !== not;
		} );
	}

	// Arraylike of elements (jQuery, arguments, Array)
	if ( typeof qualifier !== "string" ) {
		return jQuery.grep( elements, function( elem ) {
			return ( indexOf.call( qualifier, elem ) > -1 ) !== not;
		} );
	}

	// Filtered directly for both simple and complex selectors
	return jQuery.filter( qualifier, elements, not );
}

jQuery.filter = function( expr, elems, not ) {
	var elem = elems[ 0 ];

	if ( not ) {
		expr = ":not(" + expr + ")";
	}

	if ( elems.length === 1 && elem.nodeType === 1 ) {
		return jQuery.find.matchesSelector( elem, expr ) ? [ elem ] : [];
	}

	return jQuery.find.matches( expr, jQuery.grep( elems, function( elem ) {
		return elem.nodeType === 1;
	} ) );
};

jQuery.fn.extend( {
	find: function( selector ) {
		var i, ret,
			len = this.length,
			self = this;

		if ( typeof selector !== "string" ) {
			return this.pushStack( jQuery( selector ).filter( function() {
				for ( i = 0; i < len; i++ ) {
					if ( jQuery.contains( self[ i ], this ) ) {
						return true;
					}
				}
			} ) );
		}

		ret = this.pushStack( [] );

		for ( i = 0; i < len; i++ ) {
			jQuery.find( selector, self[ i ], ret );
		}

		return len > 1 ? jQuery.uniqueSort( ret ) : ret;
	},
	filter: function( selector ) {
		return this.pushStack( winnow( this, selector || [], false ) );
	},
	not: function( selector ) {
		return this.pushStack( winnow( this, selector || [], true ) );
	},
	is: function( selector ) {
		return !!winnow(
			this,

			// If this is a positional/relative selector, check membership in the returned set
			// so $("p:first").is("p:last") won't return true for a doc with two "p".
			typeof selector === "string" && rneedsContext.test( selector ) ?
				jQuery( selector ) :
				selector || [],
			false
		).length;
	}
} );


// Initialize a jQuery object


// A central reference to the root jQuery(document)
var rootjQuery,

	// A simple way to check for HTML strings
	// Prioritize #id over <tag> to avoid XSS via location.hash (#9521)
	// Strict HTML recognition (#11290: must start with <)
	// Shortcut simple #id case for speed
	rquickExpr = /^(?:\s*(<[\w\W]+>)[^>]*|#([\w-]+))$/,

	init = jQuery.fn.init = function( selector, context, root ) {
		var match, elem;

		// HANDLE: $(""), $(null), $(undefined), $(false)
		if ( !selector ) {
			return this;
		}

		// Method init() accepts an alternate rootjQuery
		// so migrate can support jQuery.sub (gh-2101)
		root = root || rootjQuery;

		// Handle HTML strings
		if ( typeof selector === "string" ) {
			if ( selector[ 0 ] === "<" &&
				selector[ selector.length - 1 ] === ">" &&
				selector.length >= 3 ) {

				// Assume that strings that start and end with <> are HTML and skip the regex check
				match = [ null, selector, null ];

			} else {
				match = rquickExpr.exec( selector );
			}

			// Match html or make sure no context is specified for #id
			if ( match && ( match[ 1 ] || !context ) ) {

				// HANDLE: $(html) -> $(array)
				if ( match[ 1 ] ) {
					context = context instanceof jQuery ? context[ 0 ] : context;

					// Option to run scripts is true for back-compat
					// Intentionally let the error be thrown if parseHTML is not present
					jQuery.merge( this, jQuery.parseHTML(
						match[ 1 ],
						context && context.nodeType ? context.ownerDocument || context : document,
						true
					) );

					// HANDLE: $(html, props)
					if ( rsingleTag.test( match[ 1 ] ) && jQuery.isPlainObject( context ) ) {
						for ( match in context ) {

							// Properties of context are called as methods if possible
							if ( isFunction( this[ match ] ) ) {
								this[ match ]( context[ match ] );

							// ...and otherwise set as attributes
							} else {
								this.attr( match, context[ match ] );
							}
						}
					}

					return this;

				// HANDLE: $(#id)
				} else {
					elem = document.getElementById( match[ 2 ] );

					if ( elem ) {

						// Inject the element directly into the jQuery object
						this[ 0 ] = elem;
						this.length = 1;
					}
					return this;
				}

			// HANDLE: $(expr, $(...))
			} else if ( !context || context.jquery ) {
				return ( context || root ).find( selector );

			// HANDLE: $(expr, context)
			// (which is just equivalent to: $(context).find(expr)
			} else {
				return this.constructor( context ).find( selector );
			}

		// HANDLE: $(DOMElement)
		} else if ( selector.nodeType ) {
			this[ 0 ] = selector;
			this.length = 1;
			return this;

		// HANDLE: $(function)
		// Shortcut for document ready
		} else if ( isFunction( selector ) ) {
			return root.ready !== undefined ?
				root.ready( selector ) :

				// Execute immediately if ready is not present
				selector( jQuery );
		}

		return jQuery.makeArray( selector, this );
	};

// Give the init function the jQuery prototype for later instantiation
init.prototype = jQuery.fn;

// Initialize central reference
rootjQuery = jQuery( document );


var rparentsprev = /^(?:parents|prev(?:Until|All))/,

	// Methods guaranteed to produce a unique set when starting from a unique set
	guaranteedUnique = {
		children: true,
		contents: true,
		next: true,
		prev: true
	};

jQuery.fn.extend( {
	has: function( target ) {
		var targets = jQuery( target, this ),
			l = targets.length;

		return this.filter( function() {
			var i = 0;
			for ( ; i < l; i++ ) {
				if ( jQuery.contains( this, targets[ i ] ) ) {
					return true;
				}
			}
		} );
	},

	closest: function( selectors, context ) {
		var cur,
			i = 0,
			l = this.length,
			matched = [],
			targets = typeof selectors !== "string" && jQuery( selectors );

		// Positional selectors never match, since there's no _selection_ context
		if ( !rneedsContext.test( selectors ) ) {
			for ( ; i < l; i++ ) {
				for ( cur = this[ i ]; cur && cur !== context; cur = cur.parentNode ) {

					// Always skip document fragments
					if ( cur.nodeType < 11 && ( targets ?
						targets.index( cur ) > -1 :

						// Don't pass non-elements to Sizzle
						cur.nodeType === 1 &&
							jQuery.find.matchesSelector( cur, selectors ) ) ) {

						matched.push( cur );
						break;
					}
				}
			}
		}

		return this.pushStack( matched.length > 1 ? jQuery.uniqueSort( matched ) : matched );
	},

	// Determine the position of an element within the set
	index: function( elem ) {

		// No argument, return index in parent
		if ( !elem ) {
			return ( this[ 0 ] && this[ 0 ].parentNode ) ? this.first().prevAll().length : -1;
		}

		// Index in selector
		if ( typeof elem === "string" ) {
			return indexOf.call( jQuery( elem ), this[ 0 ] );
		}

		// Locate the position of the desired element
		return indexOf.call( this,

			// If it receives a jQuery object, the first element is used
			elem.jquery ? elem[ 0 ] : elem
		);
	},

	add: function( selector, context ) {
		return this.pushStack(
			jQuery.uniqueSort(
				jQuery.merge( this.get(), jQuery( selector, context ) )
			)
		);
	},

	addBack: function( selector ) {
		return this.add( selector == null ?
			this.prevObject : this.prevObject.filter( selector )
		);
	}
} );

function sibling( cur, dir ) {
	while ( ( cur = cur[ dir ] ) && cur.nodeType !== 1 ) {}
	return cur;
}

jQuery.each( {
	parent: function( elem ) {
		var parent = elem.parentNode;
		return parent && parent.nodeType !== 11 ? parent : null;
	},
	parents: function( elem ) {
		return dir( elem, "parentNode" );
	},
	parentsUntil: function( elem, _i, until ) {
		return dir( elem, "parentNode", until );
	},
	next: function( elem ) {
		return sibling( elem, "nextSibling" );
	},
	prev: function( elem ) {
		return sibling( elem, "previousSibling" );
	},
	nextAll: function( elem ) {
		return dir( elem, "nextSibling" );
	},
	prevAll: function( elem ) {
		return dir( elem, "previousSibling" );
	},
	nextUntil: function( elem, _i, until ) {
		return dir( elem, "nextSibling", until );
	},
	prevUntil: function( elem, _i, until ) {
		return dir( elem, "previousSibling", until );
	},
	siblings: function( elem ) {
		return siblings( ( elem.parentNode || {} ).firstChild, elem );
	},
	children: function( elem ) {
		return siblings( elem.firstChild );
	},
	contents: function( elem ) {
		if ( elem.contentDocument != null &&

			// Support: IE 11+
			// <object> elements with no `data` attribute has an object
			// `contentDocument` with a `null` prototype.
			getProto( elem.contentDocument ) ) {

			return elem.contentDocument;
		}

		// Support: IE 9 - 11 only, iOS 7 only, Android Browser <=4.3 only
		// Treat the template element as a regular one in browsers that
		// don't support it.
		if ( nodeName( elem, "template" ) ) {
			elem = elem.content || elem;
		}

		return jQuery.merge( [], elem.childNodes );
	}
}, function( name, fn ) {
	jQuery.fn[ name ] = function( until, selector ) {
		var matched = jQuery.map( this, fn, until );

		if ( name.slice( -5 ) !== "Until" ) {
			selector = until;
		}

		if ( selector && typeof selector === "string" ) {
			matched = jQuery.filter( selector, matched );
		}

		if ( this.length > 1 ) {

			// Remove duplicates
			if ( !guaranteedUnique[ name ] ) {
				jQuery.uniqueSort( matched );
			}

			// Reverse order for parents* and prev-derivatives
			if ( rparentsprev.test( name ) ) {
				matched.reverse();
			}
		}

		return this.pushStack( matched );
	};
} );
var rnothtmlwhite = ( /[^\x20\t\r\n\f]+/g );



// Convert String-formatted options into Object-formatted ones
function createOptions( options ) {
	var object = {};
	jQuery.each( options.match( rnothtmlwhite ) || [], function( _, flag ) {
		object[ flag ] = true;
	} );
	return object;
}

/*
 * Create a callback list using the following parameters:
 *
 *	options: an optional list of space-separated options that will change how
 *			the callback list behaves or a more traditional option object
 *
 * By default a callback list will act like an event callback list and can be
 * "fired" multiple times.
 *
 * Possible options:
 *
 *	once:			will ensure the callback list can only be fired once (like a Deferred)
 *
 *	memory:			will keep track of previous values and will call any callback added
 *					after the list has been fired right away with the latest "memorized"
 *					values (like a Deferred)
 *
 *	unique:			will ensure a callback can only be added once (no duplicate in the list)
 *
 *	stopOnFalse:	interrupt callings when a callback returns false
 *
 */
jQuery.Callbacks = function( options ) {

	// Convert options from String-formatted to Object-formatted if needed
	// (we check in cache first)
	options = typeof options === "string" ?
		createOptions( options ) :
		jQuery.extend( {}, options );

	var // Flag to know if list is currently firing
		firing,

		// Last fire value for non-forgettable lists
		memory,

		// Flag to know if list was already fired
		fired,

		// Flag to prevent firing
		locked,

		// Actual callback list
		list = [],

		// Queue of execution data for repeatable lists
		queue = [],

		// Index of currently firing callback (modified by add/remove as needed)
		firingIndex = -1,

		// Fire callbacks
		fire = function() {

			// Enforce single-firing
			locked = locked || options.once;

			// Execute callbacks for all pending executions,
			// respecting firingIndex overrides and runtime changes
			fired = firing = true;
			for ( ; queue.length; firingIndex = -1 ) {
				memory = queue.shift();
				while ( ++firingIndex < list.length ) {

					// Run callback and check for early termination
					if ( list[ firingIndex ].apply( memory[ 0 ], memory[ 1 ] ) === false &&
						options.stopOnFalse ) {

						// Jump to end and forget the data so .add doesn't re-fire
						firingIndex = list.length;
						memory = false;
					}
				}
			}

			// Forget the data if we're done with it
			if ( !options.memory ) {
				memory = false;
			}

			firing = false;

			// Clean up if we're done firing for good
			if ( locked ) {

				// Keep an empty list if we have data for future add calls
				if ( memory ) {
					list = [];

				// Otherwise, this object is spent
				} else {
					list = "";
				}
			}
		},

		// Actual Callbacks object
		self = {

			// Add a callback or a collection of callbacks to the list
			add: function() {
				if ( list ) {

					// If we have memory from a past run, we should fire after adding
					if ( memory && !firing ) {
						firingIndex = list.length - 1;
						queue.push( memory );
					}

					( function add( args ) {
						jQuery.each( args, function( _, arg ) {
							if ( isFunction( arg ) ) {
								if ( !options.unique || !self.has( arg ) ) {
									list.push( arg );
								}
							} else if ( arg && arg.length && toType( arg ) !== "string" ) {

								// Inspect recursively
								add( arg );
							}
						} );
					} )( arguments );

					if ( memory && !firing ) {
						fire();
					}
				}
				return this;
			},

			// Remove a callback from the list
			remove: function() {
				jQuery.each( arguments, function( _, arg ) {
					var index;
					while ( ( index = jQuery.inArray( arg, list, index ) ) > -1 ) {
						list.splice( index, 1 );

						// Handle firing indexes
						if ( index <= firingIndex ) {
							firingIndex--;
						}
					}
				} );
				return this;
			},

			// Check if a given callback is in the list.
			// If no argument is given, return whether or not list has callbacks attached.
			has: function( fn ) {
				return fn ?
					jQuery.inArray( fn, list ) > -1 :
					list.length > 0;
			},

			// Remove all callbacks from the list
			empty: function() {
				if ( list ) {
					list = [];
				}
				return this;
			},

			// Disable .fire and .add
			// Abort any current/pending executions
			// Clear all callbacks and values
			disable: function() {
				locked = queue = [];
				list = memory = "";
				return this;
			},
			disabled: function() {
				return !list;
			},

			// Disable .fire
			// Also disable .add unless we have memory (since it would have no effect)
			// Abort any pending executions
			lock: function() {
				locked = queue = [];
				if ( !memory && !firing ) {
					list = memory = "";
				}
				return this;
			},
			locked: function() {
				return !!locked;
			},

			// Call all callbacks with the given context and arguments
			fireWith: function( context, args ) {
				if ( !locked ) {
					args = args || [];
					args = [ context, args.slice ? args.slice() : args ];
					queue.push( args );
					if ( !firing ) {
						fire();
					}
				}
				return this;
			},

			// Call all the callbacks with the given arguments
			fire: function() {
				self.fireWith( this, arguments );
				return this;
			},

			// To know if the callbacks have already been called at least once
			fired: function() {
				return !!fired;
			}
		};

	return self;
};


function Identity( v ) {
	return v;
}
function Thrower( ex ) {
	throw ex;
}

function adoptValue( value, resolve, reject, noValue ) {
	var method;

	try {

		// Check for promise aspect first to privilege synchronous behavior
		if ( value && isFunction( ( method = value.promise ) ) ) {
			method.call( value ).done( resolve ).fail( reject );

		// Other thenables
		} else if ( value && isFunction( ( method = value.then ) ) ) {
			method.call( value, resolve, reject );

		// Other non-thenables
		} else {

			// Control `resolve` arguments by letting Array#slice cast boolean `noValue` to integer:
			// * false: [ value ].slice( 0 ) => resolve( value )
			// * true: [ value ].slice( 1 ) => resolve()
			resolve.apply( undefined, [ value ].slice( noValue ) );
		}

	// For Promises/A+, convert exceptions into rejections
	// Since jQuery.when doesn't unwrap thenables, we can skip the extra checks appearing in
	// Deferred#then to conditionally suppress rejection.
	} catch ( value ) {

		// Support: Android 4.0 only
		// Strict mode functions invoked without .call/.apply get global-object context
		reject.apply( undefined, [ value ] );
	}
}

jQuery.extend( {

	Deferred: function( func ) {
		var tuples = [

				// action, add listener, callbacks,
				// ... .then handlers, argument index, [final state]
				[ "notify", "progress", jQuery.Callbacks( "memory" ),
					jQuery.Callbacks( "memory" ), 2 ],
				[ "resolve", "done", jQuery.Callbacks( "once memory" ),
					jQuery.Callbacks( "once memory" ), 0, "resolved" ],
				[ "reject", "fail", jQuery.Callbacks( "once memory" ),
					jQuery.Callbacks( "once memory" ), 1, "rejected" ]
			],
			state = "pending",
			promise = {
				state: function() {
					return state;
				},
				always: function() {
					deferred.done( arguments ).fail( arguments );
					return this;
				},
				"catch": function( fn ) {
					return promise.then( null, fn );
				},

				// Keep pipe for back-compat
				pipe: function( /* fnDone, fnFail, fnProgress */ ) {
					var fns = arguments;

					return jQuery.Deferred( function( newDefer ) {
						jQuery.each( tuples, function( _i, tuple ) {

							// Map tuples (progress, done, fail) to arguments (done, fail, progress)
							var fn = isFunction( fns[ tuple[ 4 ] ] ) && fns[ tuple[ 4 ] ];

							// deferred.progress(function() { bind to newDefer or newDefer.notify })
							// deferred.done(function() { bind to newDefer or newDefer.resolve })
							// deferred.fail(function() { bind to newDefer or newDefer.reject })
							deferred[ tuple[ 1 ] ]( function() {
								var returned = fn && fn.apply( this, arguments );
								if ( returned && isFunction( returned.promise ) ) {
									returned.promise()
										.progress( newDefer.notify )
										.done( newDefer.resolve )
										.fail( newDefer.reject );
								} else {
									newDefer[ tuple[ 0 ] + "With" ](
										this,
										fn ? [ returned ] : arguments
									);
								}
							} );
						} );
						fns = null;
					} ).promise();
				},
				then: function( onFulfilled, onRejected, onProgress ) {
					var maxDepth = 0;
					function resolve( depth, deferred, handler, special ) {
						return function() {
							var that = this,
								args = arguments,
								mightThrow = function() {
									var returned, then;

									// Support: Promises/A+ section 2.3.3.3.3
									// https://promisesaplus.com/#point-59
									// Ignore double-resolution attempts
									if ( depth < maxDepth ) {
										return;
									}

									returned = handler.apply( that, args );

									// Support: Promises/A+ section 2.3.1
									// https://promisesaplus.com/#point-48
									if ( returned === deferred.promise() ) {
										throw new TypeError( "Thenable self-resolution" );
									}

									// Support: Promises/A+ sections 2.3.3.1, 3.5
									// https://promisesaplus.com/#point-54
									// https://promisesaplus.com/#point-75
									// Retrieve `then` only once
									then = returned &&

										// Support: Promises/A+ section 2.3.4
										// https://promisesaplus.com/#point-64
										// Only check objects and functions for thenability
										( typeof returned === "object" ||
											typeof returned === "function" ) &&
										returned.then;

									// Handle a returned thenable
									if ( isFunction( then ) ) {

										// Special processors (notify) just wait for resolution
										if ( special ) {
											then.call(
												returned,
												resolve( maxDepth, deferred, Identity, special ),
												resolve( maxDepth, deferred, Thrower, special )
											);

										// Normal processors (resolve) also hook into progress
										} else {

											// ...and disregard older resolution values
											maxDepth++;

											then.call(
												returned,
												resolve( maxDepth, deferred, Identity, special ),
												resolve( maxDepth, deferred, Thrower, special ),
												resolve( maxDepth, deferred, Identity,
													deferred.notifyWith )
											);
										}

									// Handle all other returned values
									} else {

										// Only substitute handlers pass on context
										// and multiple values (non-spec behavior)
										if ( handler !== Identity ) {
											that = undefined;
											args = [ returned ];
										}

										// Process the value(s)
										// Default process is resolve
										( special || deferred.resolveWith )( that, args );
									}
								},

								// Only normal processors (resolve) catch and reject exceptions
								process = special ?
									mightThrow :
									function() {
										try {
											mightThrow();
										} catch ( e ) {

											if ( jQuery.Deferred.exceptionHook ) {
												jQuery.Deferred.exceptionHook( e,
													process.stackTrace );
											}

											// Support: Promises/A+ section 2.3.3.3.4.1
											// https://promisesaplus.com/#point-61
											// Ignore post-resolution exceptions
											if ( depth + 1 >= maxDepth ) {

												// Only substitute handlers pass on context
												// and multiple values (non-spec behavior)
												if ( handler !== Thrower ) {
													that = undefined;
													args = [ e ];
												}

												deferred.rejectWith( that, args );
											}
										}
									};

							// Support: Promises/A+ section 2.3.3.3.1
							// https://promisesaplus.com/#point-57
							// Re-resolve promises immediately to dodge false rejection from
							// subsequent errors
							if ( depth ) {
								process();
							} else {

								// Call an optional hook to record the stack, in case of exception
								// since it's otherwise lost when execution goes async
								if ( jQuery.Deferred.getStackHook ) {
									process.stackTrace = jQuery.Deferred.getStackHook();
								}
								window.setTimeout( process );
							}
						};
					}

					return jQuery.Deferred( function( newDefer ) {

						// progress_handlers.add( ... )
						tuples[ 0 ][ 3 ].add(
							resolve(
								0,
								newDefer,
								isFunction( onProgress ) ?
									onProgress :
									Identity,
								newDefer.notifyWith
							)
						);

						// fulfilled_handlers.add( ... )
						tuples[ 1 ][ 3 ].add(
							resolve(
								0,
								newDefer,
								isFunction( onFulfilled ) ?
									onFulfilled :
									Identity
							)
						);

						// rejected_handlers.add( ... )
						tuples[ 2 ][ 3 ].add(
							resolve(
								0,
								newDefer,
								isFunction( onRejected ) ?
									onRejected :
									Thrower
							)
						);
					} ).promise();
				},

				// Get a promise for this deferred
				// If obj is provided, the promise aspect is added to the object
				promise: function( obj ) {
					return obj != null ? jQuery.extend( obj, promise ) : promise;
				}
			},
			deferred = {};

		// Add list-specific methods
		jQuery.each( tuples, function( i, tuple ) {
			var list = tuple[ 2 ],
				stateString = tuple[ 5 ];

			// promise.progress = list.add
			// promise.done = list.add
			// promise.fail = list.add
			promise[ tuple[ 1 ] ] = list.add;

			// Handle state
			if ( stateString ) {
				list.add(
					function() {

						// state = "resolved" (i.e., fulfilled)
						// state = "rejected"
						state = stateString;
					},

					// rejected_callbacks.disable
					// fulfilled_callbacks.disable
					tuples[ 3 - i ][ 2 ].disable,

					// rejected_handlers.disable
					// fulfilled_handlers.disable
					tuples[ 3 - i ][ 3 ].disable,

					// progress_callbacks.lock
					tuples[ 0 ][ 2 ].lock,

					// progress_handlers.lock
					tuples[ 0 ][ 3 ].lock
				);
			}

			// progress_handlers.fire
			// fulfilled_handlers.fire
			// rejected_handlers.fire
			list.add( tuple[ 3 ].fire );

			// deferred.notify = function() { deferred.notifyWith(...) }
			// deferred.resolve = function() { deferred.resolveWith(...) }
			// deferred.reject = function() { deferred.rejectWith(...) }
			deferred[ tuple[ 0 ] ] = function() {
				deferred[ tuple[ 0 ] + "With" ]( this === deferred ? undefined : this, arguments );
				return this;
			};

			// deferred.notifyWith = list.fireWith
			// deferred.resolveWith = list.fireWith
			// deferred.rejectWith = list.fireWith
			deferred[ tuple[ 0 ] + "With" ] = list.fireWith;
		} );

		// Make the deferred a promise
		promise.promise( deferred );

		// Call given func if any
		if ( func ) {
			func.call( deferred, deferred );
		}

		// All done!
		return deferred;
	},

	// Deferred helper
	when: function( singleValue ) {
		var

			// count of uncompleted subordinates
			remaining = arguments.length,

			// count of unprocessed arguments
			i = remaining,

			// subordinate fulfillment data
			resolveContexts = Array( i ),
			resolveValues = slice.call( arguments ),

			// the master Deferred
			master = jQuery.Deferred(),

			// subordinate callback factory
			updateFunc = function( i ) {
				return function( value ) {
					resolveContexts[ i ] = this;
					resolveValues[ i ] = arguments.length > 1 ? slice.call( arguments ) : value;
					if ( !( --remaining ) ) {
						master.resolveWith( resolveContexts, resolveValues );
					}
				};
			};

		// Single- and empty arguments are adopted like Promise.resolve
		if ( remaining <= 1 ) {
			adoptValue( singleValue, master.done( updateFunc( i ) ).resolve, master.reject,
				!remaining );

			// Use .then() to unwrap secondary thenables (cf. gh-3000)
			if ( master.state() === "pending" ||
				isFunction( resolveValues[ i ] && resolveValues[ i ].then ) ) {

				return master.then();
			}
		}

		// Multiple arguments are aggregated like Promise.all array elements
		while ( i-- ) {
			adoptValue( resolveValues[ i ], updateFunc( i ), master.reject );
		}

		return master.promise();
	}
} );


// These usually indicate a programmer mistake during development,
// warn about them ASAP rather than swallowing them by default.
var rerrorNames = /^(Eval|Internal|Range|Reference|Syntax|Type|URI)Error$/;

jQuery.Deferred.exceptionHook = function( error, stack ) {

	// Support: IE 8 - 9 only
	// Console exists when dev tools are open, which can happen at any time
	if ( window.console && window.console.warn && error && rerrorNames.test( error.name ) ) {
		window.console.warn( "jQuery.Deferred exception: " + error.message, error.stack, stack );
	}
};




jQuery.readyException = function( error ) {
	window.setTimeout( function() {
		throw error;
	} );
};




// The deferred used on DOM ready
var readyList = jQuery.Deferred();

jQuery.fn.ready = function( fn ) {

	readyList
		.then( fn )

		// Wrap jQuery.readyException in a function so that the lookup
		// happens at the time of error handling instead of callback
		// registration.
		.catch( function( error ) {
			jQuery.readyException( error );
		} );

	return this;
};

jQuery.extend( {

	// Is the DOM ready to be used? Set to true once it occurs.
	isReady: false,

	// A counter to track how many items to wait for before
	// the ready event fires. See #6781
	readyWait: 1,

	// Handle when the DOM is ready
	ready: function( wait ) {

		// Abort if there are pending holds or we're already ready
		if ( wait === true ? --jQuery.readyWait : jQuery.isReady ) {
			return;
		}

		// Remember that the DOM is ready
		jQuery.isReady = true;

		// If a normal DOM Ready event fired, decrement, and wait if need be
		if ( wait !== true && --jQuery.readyWait > 0 ) {
			return;
		}

		// If there are functions bound, to execute
		readyList.resolveWith( document, [ jQuery ] );
	}
} );

jQuery.ready.then = readyList.then;

// The ready event handler and self cleanup method
function completed() {
	document.removeEventListener( "DOMContentLoaded", completed );
	window.removeEventListener( "load", completed );
	jQuery.ready();
}

// Catch cases where $(document).ready() is called
// after the browser event has already occurred.
// Support: IE <=9 - 10 only
// Older IE sometimes signals "interactive" too soon
if ( document.readyState === "complete" ||
	( document.readyState !== "loading" && !document.documentElement.doScroll ) ) {

	// Handle it asynchronously to allow scripts the opportunity to delay ready
	window.setTimeout( jQuery.ready );

} else {

	// Use the handy event callback
	document.addEventListener( "DOMContentLoaded", completed );

	// A fallback to window.onload, that will always work
	window.addEventListener( "load", completed );
}




// Multifunctional method to get and set values of a collection
// The value/s can optionally be executed if it's a function
var access = function( elems, fn, key, value, chainable, emptyGet, raw ) {
	var i = 0,
		len = elems.length,
		bulk = key == null;

	// Sets many values
	if ( toType( key ) === "object" ) {
		chainable = true;
		for ( i in key ) {
			access( elems, fn, i, key[ i ], true, emptyGet, raw );
		}

	// Sets one value
	} else if ( value !== undefined ) {
		chainable = true;

		if ( !isFunction( value ) ) {
			raw = true;
		}

		if ( bulk ) {

			// Bulk operations run against the entire set
			if ( raw ) {
				fn.call( elems, value );
				fn = null;

			// ...except when executing function values
			} else {
				bulk = fn;
				fn = function( elem, _key, value ) {
					return bulk.call( jQuery( elem ), value );
				};
			}
		}

		if ( fn ) {
			for ( ; i < len; i++ ) {
				fn(
					elems[ i ], key, raw ?
					value :
					value.call( elems[ i ], i, fn( elems[ i ], key ) )
				);
			}
		}
	}

	if ( chainable ) {
		return elems;
	}

	// Gets
	if ( bulk ) {
		return fn.call( elems );
	}

	return len ? fn( elems[ 0 ], key ) : emptyGet;
};


// Matches dashed string for camelizing
var rmsPrefix = /^-ms-/,
	rdashAlpha = /-([a-z])/g;

// Used by camelCase as callback to replace()
function fcamelCase( _all, letter ) {
	return letter.toUpperCase();
}

// Convert dashed to camelCase; used by the css and data modules
// Support: IE <=9 - 11, Edge 12 - 15
// Microsoft forgot to hump their vendor prefix (#9572)
function camelCase( string ) {
	return string.replace( rmsPrefix, "ms-" ).replace( rdashAlpha, fcamelCase );
}
var acceptData = function( owner ) {

	// Accepts only:
	//  - Node
	//    - Node.ELEMENT_NODE
	//    - Node.DOCUMENT_NODE
	//  - Object
	//    - Any
	return owner.nodeType === 1 || owner.nodeType === 9 || !( +owner.nodeType );
};




function Data() {
	this.expando = jQuery.expando + Data.uid++;
}

Data.uid = 1;

Data.prototype = {

	cache: function( owner ) {

		// Check if the owner object already has a cache
		var value = owner[ this.expando ];

		// If not, create one
		if ( !value ) {
			value = {};

			// We can accept data for non-element nodes in modern browsers,
			// but we should not, see #8335.
			// Always return an empty object.
			if ( acceptData( owner ) ) {

				// If it is a node unlikely to be stringify-ed or looped over
				// use plain assignment
				if ( owner.nodeType ) {
					owner[ this.expando ] = value;

				// Otherwise secure it in a non-enumerable property
				// configurable must be true to allow the property to be
				// deleted when data is removed
				} else {
					Object.defineProperty( owner, this.expando, {
						value: value,
						configurable: true
					} );
				}
			}
		}

		return value;
	},
	set: function( owner, data, value ) {
		var prop,
			cache = this.cache( owner );

		// Handle: [ owner, key, value ] args
		// Always use camelCase key (gh-2257)
		if ( typeof data === "string" ) {
			cache[ camelCase( data ) ] = value;

		// Handle: [ owner, { properties } ] args
		} else {

			// Copy the properties one-by-one to the cache object
			for ( prop in data ) {
				cache[ camelCase( prop ) ] = data[ prop ];
			}
		}
		return cache;
	},
	get: function( owner, key ) {
		return key === undefined ?
			this.cache( owner ) :

			// Always use camelCase key (gh-2257)
			owner[ this.expando ] && owner[ this.expando ][ camelCase( key ) ];
	},
	access: function( owner, key, value ) {

		// In cases where either:
		//
		//   1. No key was specified
		//   2. A string key was specified, but no value provided
		//
		// Take the "read" path and allow the get method to determine
		// which value to return, respectively either:
		//
		//   1. The entire cache object
		//   2. The data stored at the key
		//
		if ( key === undefined ||
				( ( key && typeof key === "string" ) && value === undefined ) ) {

			return this.get( owner, key );
		}

		// When the key is not a string, or both a key and value
		// are specified, set or extend (existing objects) with either:
		//
		//   1. An object of properties
		//   2. A key and value
		//
		this.set( owner, key, value );

		// Since the "set" path can have two possible entry points
		// return the expected data based on which path was taken[*]
		return value !== undefined ? value : key;
	},
	remove: function( owner, key ) {
		var i,
			cache = owner[ this.expando ];

		if ( cache === undefined ) {
			return;
		}

		if ( key !== undefined ) {

			// Support array or space separated string of keys
			if ( Array.isArray( key ) ) {

				// If key is an array of keys...
				// We always set camelCase keys, so remove that.
				key = key.map( camelCase );
			} else {
				key = camelCase( key );

				// If a key with the spaces exists, use it.
				// Otherwise, create an array by matching non-whitespace
				key = key in cache ?
					[ key ] :
					( key.match( rnothtmlwhite ) || [] );
			}

			i = key.length;

			while ( i-- ) {
				delete cache[ key[ i ] ];
			}
		}

		// Remove the expando if there's no more data
		if ( key === undefined || jQuery.isEmptyObject( cache ) ) {

			// Support: Chrome <=35 - 45
			// Webkit & Blink performance suffers when deleting properties
			// from DOM nodes, so set to undefined instead
			// https://bugs.chromium.org/p/chromium/issues/detail?id=378607 (bug restricted)
			if ( owner.nodeType ) {
				owner[ this.expando ] = undefined;
			} else {
				delete owner[ this.expando ];
			}
		}
	},
	hasData: function( owner ) {
		var cache = owner[ this.expando ];
		return cache !== undefined && !jQuery.isEmptyObject( cache );
	}
};
var dataPriv = new Data();

var dataUser = new Data();



//	Implementation Summary
//
//	1. Enforce API surface and semantic compatibility with 1.9.x branch
//	2. Improve the module's maintainability by reducing the storage
//		paths to a single mechanism.
//	3. Use the same single mechanism to support "private" and "user" data.
//	4. _Never_ expose "private" data to user code (TODO: Drop _data, _removeData)
//	5. Avoid exposing implementation details on user objects (eg. expando properties)
//	6. Provide a clear path for implementation upgrade to WeakMap in 2014

var rbrace = /^(?:\{[\w\W]*\}|\[[\w\W]*\])$/,
	rmultiDash = /[A-Z]/g;

function getData( data ) {
	if ( data === "true" ) {
		return true;
	}

	if ( data === "false" ) {
		return false;
	}

	if ( data === "null" ) {
		return null;
	}

	// Only convert to a number if it doesn't change the string
	if ( data === +data + "" ) {
		return +data;
	}

	if ( rbrace.test( data ) ) {
		return JSON.parse( data );
	}

	return data;
}

function dataAttr( elem, key, data ) {
	var name;

	// If nothing was found internally, try to fetch any
	// data from the HTML5 data-* attribute
	if ( data === undefined && elem.nodeType === 1 ) {
		name = "data-" + key.replace( rmultiDash, "-$&" ).toLowerCase();
		data = elem.getAttribute( name );

		if ( typeof data === "string" ) {
			try {
				data = getData( data );
			} catch ( e ) {}

			// Make sure we set the data so it isn't changed later
			dataUser.set( elem, key, data );
		} else {
			data = undefined;
		}
	}
	return data;
}

jQuery.extend( {
	hasData: function( elem ) {
		return dataUser.hasData( elem ) || dataPriv.hasData( elem );
	},

	data: function( elem, name, data ) {
		return dataUser.access( elem, name, data );
	},

	removeData: function( elem, name ) {
		dataUser.remove( elem, name );
	},

	// TODO: Now that all calls to _data and _removeData have been replaced
	// with direct calls to dataPriv methods, these can be deprecated.
	_data: function( elem, name, data ) {
		return dataPriv.access( elem, name, data );
	},

	_removeData: function( elem, name ) {
		dataPriv.remove( elem, name );
	}
} );

jQuery.fn.extend( {
	data: function( key, value ) {
		var i, name, data,
			elem = this[ 0 ],
			attrs = elem && elem.attributes;

		// Gets all values
		if ( key === undefined ) {
			if ( this.length ) {
				data = dataUser.get( elem );

				if ( elem.nodeType === 1 && !dataPriv.get( elem, "hasDataAttrs" ) ) {
					i = attrs.length;
					while ( i-- ) {

						// Support: IE 11 only
						// The attrs elements can be null (#14894)
						if ( attrs[ i ] ) {
							name = attrs[ i ].name;
							if ( name.indexOf( "data-" ) === 0 ) {
								name = camelCase( name.slice( 5 ) );
								dataAttr( elem, name, data[ name ] );
							}
						}
					}
					dataPriv.set( elem, "hasDataAttrs", true );
				}
			}

			return data;
		}

		// Sets multiple values
		if ( typeof key === "object" ) {
			return this.each( function() {
				dataUser.set( this, key );
			} );
		}

		return access( this, function( value ) {
			var data;

			// The calling jQuery object (element matches) is not empty
			// (and therefore has an element appears at this[ 0 ]) and the
			// `value` parameter was not undefined. An empty jQuery object
			// will result in `undefined` for elem = this[ 0 ] which will
			// throw an exception if an attempt to read a data cache is made.
			if ( elem && value === undefined ) {

				// Attempt to get data from the cache
				// The key will always be camelCased in Data
				data = dataUser.get( elem, key );
				if ( data !== undefined ) {
					return data;
				}

				// Attempt to "discover" the data in
				// HTML5 custom data-* attrs
				data = dataAttr( elem, key );
				if ( data !== undefined ) {
					return data;
				}

				// We tried really hard, but the data doesn't exist.
				return;
			}

			// Set the data...
			this.each( function() {

				// We always store the camelCased key
				dataUser.set( this, key, value );
			} );
		}, null, value, arguments.length > 1, null, true );
	},

	removeData: function( key ) {
		return this.each( function() {
			dataUser.remove( this, key );
		} );
	}
} );


jQuery.extend( {
	queue: function( elem, type, data ) {
		var queue;

		if ( elem ) {
			type = ( type || "fx" ) + "queue";
			queue = dataPriv.get( elem, type );

			// Speed up dequeue by getting out quickly if this is just a lookup
			if ( data ) {
				if ( !queue || Array.isArray( data ) ) {
					queue = dataPriv.access( elem, type, jQuery.makeArray( data ) );
				} else {
					queue.push( data );
				}
			}
			return queue || [];
		}
	},

	dequeue: function( elem, type ) {
		type = type || "fx";

		var queue = jQuery.queue( elem, type ),
			startLength = queue.length,
			fn = queue.shift(),
			hooks = jQuery._queueHooks( elem, type ),
			next = function() {
				jQuery.dequeue( elem, type );
			};

		// If the fx queue is dequeued, always remove the progress sentinel
		if ( fn === "inprogress" ) {
			fn = queue.shift();
			startLength--;
		}

		if ( fn ) {

			// Add a progress sentinel to prevent the fx queue from being
			// automatically dequeued
			if ( type === "fx" ) {
				queue.unshift( "inprogress" );
			}

			// Clear up the last queue stop function
			delete hooks.stop;
			fn.call( elem, next, hooks );
		}

		if ( !startLength && hooks ) {
			hooks.empty.fire();
		}
	},

	// Not public - generate a queueHooks object, or return the current one
	_queueHooks: function( elem, type ) {
		var key = type + "queueHooks";
		return dataPriv.get( elem, key ) || dataPriv.access( elem, key, {
			empty: jQuery.Callbacks( "once memory" ).add( function() {
				dataPriv.remove( elem, [ type + "queue", key ] );
			} )
		} );
	}
} );

jQuery.fn.extend( {
	queue: function( type, data ) {
		var setter = 2;

		if ( typeof type !== "string" ) {
			data = type;
			type = "fx";
			setter--;
		}

		if ( arguments.length < setter ) {
			return jQuery.queue( this[ 0 ], type );
		}

		return data === undefined ?
			this :
			this.each( function() {
				var queue = jQuery.queue( this, type, data );

				// Ensure a hooks for this queue
				jQuery._queueHooks( this, type );

				if ( type === "fx" && queue[ 0 ] !== "inprogress" ) {
					jQuery.dequeue( this, type );
				}
			} );
	},
	dequeue: function( type ) {
		return this.each( function() {
			jQuery.dequeue( this, type );
		} );
	},
	clearQueue: function( type ) {
		return this.queue( type || "fx", [] );
	},

	// Get a promise resolved when queues of a certain type
	// are emptied (fx is the type by default)
	promise: function( type, obj ) {
		var tmp,
			count = 1,
			defer = jQuery.Deferred(),
			elements = this,
			i = this.length,
			resolve = function() {
				if ( !( --count ) ) {
					defer.resolveWith( elements, [ elements ] );
				}
			};

		if ( typeof type !== "string" ) {
			obj = type;
			type = undefined;
		}
		type = type || "fx";

		while ( i-- ) {
			tmp = dataPriv.get( elements[ i ], type + "queueHooks" );
			if ( tmp && tmp.empty ) {
				count++;
				tmp.empty.add( resolve );
			}
		}
		resolve();
		return defer.promise( obj );
	}
} );
var pnum = ( /[+-]?(?:\d*\.|)\d+(?:[eE][+-]?\d+|)/ ).source;

var rcssNum = new RegExp( "^(?:([+-])=|)(" + pnum + ")([a-z%]*)$", "i" );


var cssExpand = [ "Top", "Right", "Bottom", "Left" ];

var documentElement = document.documentElement;



	var isAttached = function( elem ) {
			return jQuery.contains( elem.ownerDocument, elem );
		},
		composed = { composed: true };

	// Support: IE 9 - 11+, Edge 12 - 18+, iOS 10.0 - 10.2 only
	// Check attachment across shadow DOM boundaries when possible (gh-3504)
	// Support: iOS 10.0-10.2 only
	// Early iOS 10 versions support `attachShadow` but not `getRootNode`,
	// leading to errors. We need to check for `getRootNode`.
	if ( documentElement.getRootNode ) {
		isAttached = function( elem ) {
			return jQuery.contains( elem.ownerDocument, elem ) ||
				elem.getRootNode( composed ) === elem.ownerDocument;
		};
	}
var isHiddenWithinTree = function( elem, el ) {

		// isHiddenWithinTree might be called from jQuery#filter function;
		// in that case, element will be second argument
		elem = el || elem;

		// Inline style trumps all
		return elem.style.display === "none" ||
			elem.style.display === "" &&

			// Otherwise, check computed style
			// Support: Firefox <=43 - 45
			// Disconnected elements can have computed display: none, so first confirm that elem is
			// in the document.
			isAttached( elem ) &&

			jQuery.css( elem, "display" ) === "none";
	};



function adjustCSS( elem, prop, valueParts, tween ) {
	var adjusted, scale,
		maxIterations = 20,
		currentValue = tween ?
			function() {
				return tween.cur();
			} :
			function() {
				return jQuery.css( elem, prop, "" );
			},
		initial = currentValue(),
		unit = valueParts && valueParts[ 3 ] || ( jQuery.cssNumber[ prop ] ? "" : "px" ),

		// Starting value computation is required for potential unit mismatches
		initialInUnit = elem.nodeType &&
			( jQuery.cssNumber[ prop ] || unit !== "px" && +initial ) &&
			rcssNum.exec( jQuery.css( elem, prop ) );

	if ( initialInUnit && initialInUnit[ 3 ] !== unit ) {

		// Support: Firefox <=54
		// Halve the iteration target value to prevent interference from CSS upper bounds (gh-2144)
		initial = initial / 2;

		// Trust units reported by jQuery.css
		unit = unit || initialInUnit[ 3 ];

		// Iteratively approximate from a nonzero starting point
		initialInUnit = +initial || 1;

		while ( maxIterations-- ) {

			// Evaluate and update our best guess (doubling guesses that zero out).
			// Finish if the scale equals or crosses 1 (making the old*new product non-positive).
			jQuery.style( elem, prop, initialInUnit + unit );
			if ( ( 1 - scale ) * ( 1 - ( scale = currentValue() / initial || 0.5 ) ) <= 0 ) {
				maxIterations = 0;
			}
			initialInUnit = initialInUnit / scale;

		}

		initialInUnit = initialInUnit * 2;
		jQuery.style( elem, prop, initialInUnit + unit );

		// Make sure we update the tween properties later on
		valueParts = valueParts || [];
	}

	if ( valueParts ) {
		initialInUnit = +initialInUnit || +initial || 0;

		// Apply relative offset (+=/-=) if specified
		adjusted = valueParts[ 1 ] ?
			initialInUnit + ( valueParts[ 1 ] + 1 ) * valueParts[ 2 ] :
			+valueParts[ 2 ];
		if ( tween ) {
			tween.unit = unit;
			tween.start = initialInUnit;
			tween.end = adjusted;
		}
	}
	return adjusted;
}


var defaultDisplayMap = {};

function getDefaultDisplay( elem ) {
	var temp,
		doc = elem.ownerDocument,
		nodeName = elem.nodeName,
		display = defaultDisplayMap[ nodeName ];

	if ( display ) {
		return display;
	}

	temp = doc.body.appendChild( doc.createElement( nodeName ) );
	display = jQuery.css( temp, "display" );

	temp.parentNode.removeChild( temp );

	if ( display === "none" ) {
		display = "block";
	}
	defaultDisplayMap[ nodeName ] = display;

	return display;
}

function showHide( elements, show ) {
	var display, elem,
		values = [],
		index = 0,
		length = elements.length;

	// Determine new display value for elements that need to change
	for ( ; index < length; index++ ) {
		elem = elements[ index ];
		if ( !elem.style ) {
			continue;
		}

		display = elem.style.display;
		if ( show ) {

			// Since we force visibility upon cascade-hidden elements, an immediate (and slow)
			// check is required in this first loop unless we have a nonempty display value (either
			// inline or about-to-be-restored)
			if ( display === "none" ) {
				values[ index ] = dataPriv.get( elem, "display" ) || null;
				if ( !values[ index ] ) {
					elem.style.display = "";
				}
			}
			if ( elem.style.display === "" && isHiddenWithinTree( elem ) ) {
				values[ index ] = getDefaultDisplay( elem );
			}
		} else {
			if ( display !== "none" ) {
				values[ index ] = "none";

				// Remember what we're overwriting
				dataPriv.set( elem, "display", display );
			}
		}
	}

	// Set the display of the elements in a second loop to avoid constant reflow
	for ( index = 0; index < length; index++ ) {
		if ( values[ index ] != null ) {
			elements[ index ].style.display = values[ index ];
		}
	}

	return elements;
}

jQuery.fn.extend( {
	show: function() {
		return showHide( this, true );
	},
	hide: function() {
		return showHide( this );
	},
	toggle: function( state ) {
		if ( typeof state === "boolean" ) {
			return state ? this.show() : this.hide();
		}

		return this.each( function() {
			if ( isHiddenWithinTree( this ) ) {
				jQuery( this ).show();
			} else {
				jQuery( this ).hide();
			}
		} );
	}
} );
var rcheckableType = ( /^(?:checkbox|radio)$/i );

var rtagName = ( /<([a-z][^\/\0>\x20\t\r\n\f]*)/i );

var rscriptType = ( /^$|^module$|\/(?:java|ecma)script/i );



( function() {
	var fragment = document.createDocumentFragment(),
		div = fragment.appendChild( document.createElement( "div" ) ),
		input = document.createElement( "input" );

	// Support: Android 4.0 - 4.3 only
	// Check state lost if the name is set (#11217)
	// Support: Windows Web Apps (WWA)
	// `name` and `type` must use .setAttribute for WWA (#14901)
	input.setAttribute( "type", "radio" );
	input.setAttribute( "checked", "checked" );
	input.setAttribute( "name", "t" );

	div.appendChild( input );

	// Support: Android <=4.1 only
	// Older WebKit doesn't clone checked state correctly in fragments
	support.checkClone = div.cloneNode( true ).cloneNode( true ).lastChild.checked;

	// Support: IE <=11 only
	// Make sure textarea (and checkbox) defaultValue is properly cloned
	div.innerHTML = "<textarea>x</textarea>";
	support.noCloneChecked = !!div.cloneNode( true ).lastChild.defaultValue;

	// Support: IE <=9 only
	// IE <=9 replaces <option> tags with their contents when inserted outside of
	// the select element.
	div.innerHTML = "<option></option>";
	support.option = !!div.lastChild;
} )();


// We have to close these tags to support XHTML (#13200)
var wrapMap = {

	// XHTML parsers do not magically insert elements in the
	// same way that tag soup parsers do. So we cannot shorten
	// this by omitting <tbody> or other required elements.
	thead: [ 1, "<table>", "</table>" ],
	col: [ 2, "<table><colgroup>", "</colgroup></table>" ],
	tr: [ 2, "<table><tbody>", "</tbody></table>" ],
	td: [ 3, "<table><tbody><tr>", "</tr></tbody></table>" ],

	_default: [ 0, "", "" ]
};

wrapMap.tbody = wrapMap.tfoot = wrapMap.colgroup = wrapMap.caption = wrapMap.thead;
wrapMap.th = wrapMap.td;

// Support: IE <=9 only
if ( !support.option ) {
	wrapMap.optgroup = wrapMap.option = [ 1, "<select multiple='multiple'>", "</select>" ];
}


function getAll( context, tag ) {

	// Support: IE <=9 - 11 only
	// Use typeof to avoid zero-argument method invocation on host objects (#15151)
	var ret;

	if ( typeof context.getElementsByTagName !== "undefined" ) {
		ret = context.getElementsByTagName( tag || "*" );

	} else if ( typeof context.querySelectorAll !== "undefined" ) {
		ret = context.querySelectorAll( tag || "*" );

	} else {
		ret = [];
	}

	if ( tag === undefined || tag && nodeName( context, tag ) ) {
		return jQuery.merge( [ context ], ret );
	}

	return ret;
}


// Mark scripts as having already been evaluated
function setGlobalEval( elems, refElements ) {
	var i = 0,
		l = elems.length;

	for ( ; i < l; i++ ) {
		dataPriv.set(
			elems[ i ],
			"globalEval",
			!refElements || dataPriv.get( refElements[ i ], "globalEval" )
		);
	}
}


var rhtml = /<|&#?\w+;/;

function buildFragment( elems, context, scripts, selection, ignored ) {
	var elem, tmp, tag, wrap, attached, j,
		fragment = context.createDocumentFragment(),
		nodes = [],
		i = 0,
		l = elems.length;

	for ( ; i < l; i++ ) {
		elem = elems[ i ];

		if ( elem || elem === 0 ) {

			// Add nodes directly
			if ( toType( elem ) === "object" ) {

				// Support: Android <=4.0 only, PhantomJS 1 only
				// push.apply(_, arraylike) throws on ancient WebKit
				jQuery.merge( nodes, elem.nodeType ? [ elem ] : elem );

			// Convert non-html into a text node
			} else if ( !rhtml.test( elem ) ) {
				nodes.push( context.createTextNode( elem ) );

			// Convert html into DOM nodes
			} else {
				tmp = tmp || fragment.appendChild( context.createElement( "div" ) );

				// Deserialize a standard representation
				tag = ( rtagName.exec( elem ) || [ "", "" ] )[ 1 ].toLowerCase();
				wrap = wrapMap[ tag ] || wrapMap._default;
				tmp.innerHTML = wrap[ 1 ] + jQuery.htmlPrefilter( elem ) + wrap[ 2 ];

				// Descend through wrappers to the right content
				j = wrap[ 0 ];
				while ( j-- ) {
					tmp = tmp.lastChild;
				}

				// Support: Android <=4.0 only, PhantomJS 1 only
				// push.apply(_, arraylike) throws on ancient WebKit
				jQuery.merge( nodes, tmp.childNodes );

				// Remember the top-level container
				tmp = fragment.firstChild;

				// Ensure the created nodes are orphaned (#12392)
				tmp.textContent = "";
			}
		}
	}

	// Remove wrapper from fragment
	fragment.textContent = "";

	i = 0;
	while ( ( elem = nodes[ i++ ] ) ) {

		// Skip elements already in the context collection (trac-4087)
		if ( selection && jQuery.inArray( elem, selection ) > -1 ) {
			if ( ignored ) {
				ignored.push( elem );
			}
			continue;
		}

		attached = isAttached( elem );

		// Append to fragment
		tmp = getAll( fragment.appendChild( elem ), "script" );

		// Preserve script evaluation history
		if ( attached ) {
			setGlobalEval( tmp );
		}

		// Capture executables
		if ( scripts ) {
			j = 0;
			while ( ( elem = tmp[ j++ ] ) ) {
				if ( rscriptType.test( elem.type || "" ) ) {
					scripts.push( elem );
				}
			}
		}
	}

	return fragment;
}


var
	rkeyEvent = /^key/,
	rmouseEvent = /^(?:mouse|pointer|contextmenu|drag|drop)|click/,
	rtypenamespace = /^([^.]*)(?:\.(.+)|)/;

function returnTrue() {
	return true;
}

function returnFalse() {
	return false;
}

// Support: IE <=9 - 11+
// focus() and blur() are asynchronous, except when they are no-op.
// So expect focus to be synchronous when the element is already active,
// and blur to be synchronous when the element is not already active.
// (focus and blur are always synchronous in other supported browsers,
// this just defines when we can count on it).
function expectSync( elem, type ) {
	return ( elem === safeActiveElement() ) === ( type === "focus" );
}

// Support: IE <=9 only
// Accessing document.activeElement can throw unexpectedly
// https://bugs.jquery.com/ticket/13393
function safeActiveElement() {
	try {
		return document.activeElement;
	} catch ( err ) { }
}

function on( elem, types, selector, data, fn, one ) {
	var origFn, type;

	// Types can be a map of types/handlers
	if ( typeof types === "object" ) {

		// ( types-Object, selector, data )
		if ( typeof selector !== "string" ) {

			// ( types-Object, data )
			data = data || selector;
			selector = undefined;
		}
		for ( type in types ) {
			on( elem, type, selector, data, types[ type ], one );
		}
		return elem;
	}

	if ( data == null && fn == null ) {

		// ( types, fn )
		fn = selector;
		data = selector = undefined;
	} else if ( fn == null ) {
		if ( typeof selector === "string" ) {

			// ( types, selector, fn )
			fn = data;
			data = undefined;
		} else {

			// ( types, data, fn )
			fn = data;
			data = selector;
			selector = undefined;
		}
	}
	if ( fn === false ) {
		fn = returnFalse;
	} else if ( !fn ) {
		return elem;
	}

	if ( one === 1 ) {
		origFn = fn;
		fn = function( event ) {

			// Can use an empty set, since event contains the info
			jQuery().off( event );
			return origFn.apply( this, arguments );
		};

		// Use same guid so caller can remove using origFn
		fn.guid = origFn.guid || ( origFn.guid = jQuery.guid++ );
	}
	return elem.each( function() {
		jQuery.event.add( this, types, fn, data, selector );
	} );
}

/*
 * Helper functions for managing events -- not part of the public interface.
 * Props to Dean Edwards' addEvent library for many of the ideas.
 */
jQuery.event = {

	global: {},

	add: function( elem, types, handler, data, selector ) {

		var handleObjIn, eventHandle, tmp,
			events, t, handleObj,
			special, handlers, type, namespaces, origType,
			elemData = dataPriv.get( elem );

		// Only attach events to objects that accept data
		if ( !acceptData( elem ) ) {
			return;
		}

		// Caller can pass in an object of custom data in lieu of the handler
		if ( handler.handler ) {
			handleObjIn = handler;
			handler = handleObjIn.handler;
			selector = handleObjIn.selector;
		}

		// Ensure that invalid selectors throw exceptions at attach time
		// Evaluate against documentElement in case elem is a non-element node (e.g., document)
		if ( selector ) {
			jQuery.find.matchesSelector( documentElement, selector );
		}

		// Make sure that the handler has a unique ID, used to find/remove it later
		if ( !handler.guid ) {
			handler.guid = jQuery.guid++;
		}

		// Init the element's event structure and main handler, if this is the first
		if ( !( events = elemData.events ) ) {
			events = elemData.events = Object.create( null );
		}
		if ( !( eventHandle = elemData.handle ) ) {
			eventHandle = elemData.handle = function( e ) {

				// Discard the second event of a jQuery.event.trigger() and
				// when an event is called after a page has unloaded
				return typeof jQuery !== "undefined" && jQuery.event.triggered !== e.type ?
					jQuery.event.dispatch.apply( elem, arguments ) : undefined;
			};
		}

		// Handle multiple events separated by a space
		types = ( types || "" ).match( rnothtmlwhite ) || [ "" ];
		t = types.length;
		while ( t-- ) {
			tmp = rtypenamespace.exec( types[ t ] ) || [];
			type = origType = tmp[ 1 ];
			namespaces = ( tmp[ 2 ] || "" ).split( "." ).sort();

			// There *must* be a type, no attaching namespace-only handlers
			if ( !type ) {
				continue;
			}

			// If event changes its type, use the special event handlers for the changed type
			special = jQuery.event.special[ type ] || {};

			// If selector defined, determine special event api type, otherwise given type
			type = ( selector ? special.delegateType : special.bindType ) || type;

			// Update special based on newly reset type
			special = jQuery.event.special[ type ] || {};

			// handleObj is passed to all event handlers
			handleObj = jQuery.extend( {
				type: type,
				origType: origType,
				data: data,
				handler: handler,
				guid: handler.guid,
				selector: selector,
				needsContext: selector && jQuery.expr.match.needsContext.test( selector ),
				namespace: namespaces.join( "." )
			}, handleObjIn );

			// Init the event handler queue if we're the first
			if ( !( handlers = events[ type ] ) ) {
				handlers = events[ type ] = [];
				handlers.delegateCount = 0;

				// Only use addEventListener if the special events handler returns false
				if ( !special.setup ||
					special.setup.call( elem, data, namespaces, eventHandle ) === false ) {

					if ( elem.addEventListener ) {
						elem.addEventListener( type, eventHandle );
					}
				}
			}

			if ( special.add ) {
				special.add.call( elem, handleObj );

				if ( !handleObj.handler.guid ) {
					handleObj.handler.guid = handler.guid;
				}
			}

			// Add to the element's handler list, delegates in front
			if ( selector ) {
				handlers.splice( handlers.delegateCount++, 0, handleObj );
			} else {
				handlers.push( handleObj );
			}

			// Keep track of which events have ever been used, for event optimization
			jQuery.event.global[ type ] = true;
		}

	},

	// Detach an event or set of events from an element
	remove: function( elem, types, handler, selector, mappedTypes ) {

		var j, origCount, tmp,
			events, t, handleObj,
			special, handlers, type, namespaces, origType,
			elemData = dataPriv.hasData( elem ) && dataPriv.get( elem );

		if ( !elemData || !( events = elemData.events ) ) {
			return;
		}

		// Once for each type.namespace in types; type may be omitted
		types = ( types || "" ).match( rnothtmlwhite ) || [ "" ];
		t = types.length;
		while ( t-- ) {
			tmp = rtypenamespace.exec( types[ t ] ) || [];
			type = origType = tmp[ 1 ];
			namespaces = ( tmp[ 2 ] || "" ).split( "." ).sort();

			// Unbind all events (on this namespace, if provided) for the element
			if ( !type ) {
				for ( type in events ) {
					jQuery.event.remove( elem, type + types[ t ], handler, selector, true );
				}
				continue;
			}

			special = jQuery.event.special[ type ] || {};
			type = ( selector ? special.delegateType : special.bindType ) || type;
			handlers = events[ type ] || [];
			tmp = tmp[ 2 ] &&
				new RegExp( "(^|\\.)" + namespaces.join( "\\.(?:.*\\.|)" ) + "(\\.|$)" );

			// Remove matching events
			origCount = j = handlers.length;
			while ( j-- ) {
				handleObj = handlers[ j ];

				if ( ( mappedTypes || origType === handleObj.origType ) &&
					( !handler || handler.guid === handleObj.guid ) &&
					( !tmp || tmp.test( handleObj.namespace ) ) &&
					( !selector || selector === handleObj.selector ||
						selector === "**" && handleObj.selector ) ) {
					handlers.splice( j, 1 );

					if ( handleObj.selector ) {
						handlers.delegateCount--;
					}
					if ( special.remove ) {
						special.remove.call( elem, handleObj );
					}
				}
			}

			// Remove generic event handler if we removed something and no more handlers exist
			// (avoids potential for endless recursion during removal of special event handlers)
			if ( origCount && !handlers.length ) {
				if ( !special.teardown ||
					special.teardown.call( elem, namespaces, elemData.handle ) === false ) {

					jQuery.removeEvent( elem, type, elemData.handle );
				}

				delete events[ type ];
			}
		}

		// Remove data and the expando if it's no longer used
		if ( jQuery.isEmptyObject( events ) ) {
			dataPriv.remove( elem, "handle events" );
		}
	},

	dispatch: function( nativeEvent ) {

		var i, j, ret, matched, handleObj, handlerQueue,
			args = new Array( arguments.length ),

			// Make a writable jQuery.Event from the native event object
			event = jQuery.event.fix( nativeEvent ),

			handlers = (
					dataPriv.get( this, "events" ) || Object.create( null )
				)[ event.type ] || [],
			special = jQuery.event.special[ event.type ] || {};

		// Use the fix-ed jQuery.Event rather than the (read-only) native event
		args[ 0 ] = event;

		for ( i = 1; i < arguments.length; i++ ) {
			args[ i ] = arguments[ i ];
		}

		event.delegateTarget = this;

		// Call the preDispatch hook for the mapped type, and let it bail if desired
		if ( special.preDispatch && special.preDispatch.call( this, event ) === false ) {
			return;
		}

		// Determine handlers
		handlerQueue = jQuery.event.handlers.call( this, event, handlers );

		// Run delegates first; they may want to stop propagation beneath us
		i = 0;
		while ( ( matched = handlerQueue[ i++ ] ) && !event.isPropagationStopped() ) {
			event.currentTarget = matched.elem;

			j = 0;
			while ( ( handleObj = matched.handlers[ j++ ] ) &&
				!event.isImmediatePropagationStopped() ) {

				// If the event is namespaced, then each handler is only invoked if it is
				// specially universal or its namespaces are a superset of the event's.
				if ( !event.rnamespace || handleObj.namespace === false ||
					event.rnamespace.test( handleObj.namespace ) ) {

					event.handleObj = handleObj;
					event.data = handleObj.data;

					ret = ( ( jQuery.event.special[ handleObj.origType ] || {} ).handle ||
						handleObj.handler ).apply( matched.elem, args );

					if ( ret !== undefined ) {
						if ( ( event.result = ret ) === false ) {
							event.preventDefault();
							event.stopPropagation();
						}
					}
				}
			}
		}

		// Call the postDispatch hook for the mapped type
		if ( special.postDispatch ) {
			special.postDispatch.call( this, event );
		}

		return event.result;
	},

	handlers: function( event, handlers ) {
		var i, handleObj, sel, matchedHandlers, matchedSelectors,
			handlerQueue = [],
			delegateCount = handlers.delegateCount,
			cur = event.target;

		// Find delegate handlers
		if ( delegateCount &&

			// Support: IE <=9
			// Black-hole SVG <use> instance trees (trac-13180)
			cur.nodeType &&

			// Support: Firefox <=42
			// Suppress spec-violating clicks indicating a non-primary pointer button (trac-3861)
			// https://www.w3.org/TR/DOM-Level-3-Events/#event-type-click
			// Support: IE 11 only
			// ...but not arrow key "clicks" of radio inputs, which can have `button` -1 (gh-2343)
			!( event.type === "click" && event.button >= 1 ) ) {

			for ( ; cur !== this; cur = cur.parentNode || this ) {

				// Don't check non-elements (#13208)
				// Don't process clicks on disabled elements (#6911, #8165, #11382, #11764)
				if ( cur.nodeType === 1 && !( event.type === "click" && cur.disabled === true ) ) {
					matchedHandlers = [];
					matchedSelectors = {};
					for ( i = 0; i < delegateCount; i++ ) {
						handleObj = handlers[ i ];

						// Don't conflict with Object.prototype properties (#13203)
						sel = handleObj.selector + " ";

						if ( matchedSelectors[ sel ] === undefined ) {
							matchedSelectors[ sel ] = handleObj.needsContext ?
								jQuery( sel, this ).index( cur ) > -1 :
								jQuery.find( sel, this, null, [ cur ] ).length;
						}
						if ( matchedSelectors[ sel ] ) {
							matchedHandlers.push( handleObj );
						}
					}
					if ( matchedHandlers.length ) {
						handlerQueue.push( { elem: cur, handlers: matchedHandlers } );
					}
				}
			}
		}

		// Add the remaining (directly-bound) handlers
		cur = this;
		if ( delegateCount < handlers.length ) {
			handlerQueue.push( { elem: cur, handlers: handlers.slice( delegateCount ) } );
		}

		return handlerQueue;
	},

	addProp: function( name, hook ) {
		Object.defineProperty( jQuery.Event.prototype, name, {
			enumerable: true,
			configurable: true,

			get: isFunction( hook ) ?
				function() {
					if ( this.originalEvent ) {
							return hook( this.originalEvent );
					}
				} :
				function() {
					if ( this.originalEvent ) {
							return this.originalEvent[ name ];
					}
				},

			set: function( value ) {
				Object.defineProperty( this, name, {
					enumerable: true,
					configurable: true,
					writable: true,
					value: value
				} );
			}
		} );
	},

	fix: function( originalEvent ) {
		return originalEvent[ jQuery.expando ] ?
			originalEvent :
			new jQuery.Event( originalEvent );
	},

	special: {
		load: {

			// Prevent triggered image.load events from bubbling to window.load
			noBubble: true
		},
		click: {

			// Utilize native event to ensure correct state for checkable inputs
			setup: function( data ) {

				// For mutual compressibility with _default, replace `this` access with a local var.
				// `|| data` is dead code meant only to preserve the variable through minification.
				var el = this || data;

				// Claim the first handler
				if ( rcheckableType.test( el.type ) &&
					el.click && nodeName( el, "input" ) ) {

					// dataPriv.set( el, "click", ... )
					leverageNative( el, "click", returnTrue );
				}

				// Return false to allow normal processing in the caller
				return false;
			},
			trigger: function( data ) {

				// For mutual compressibility with _default, replace `this` access with a local var.
				// `|| data` is dead code meant only to preserve the variable through minification.
				var el = this || data;

				// Force setup before triggering a click
				if ( rcheckableType.test( el.type ) &&
					el.click && nodeName( el, "input" ) ) {

					leverageNative( el, "click" );
				}

				// Return non-false to allow normal event-path propagation
				return true;
			},

			// For cross-browser consistency, suppress native .click() on links
			// Also prevent it if we're currently inside a leveraged native-event stack
			_default: function( event ) {
				var target = event.target;
				return rcheckableType.test( target.type ) &&
					target.click && nodeName( target, "input" ) &&
					dataPriv.get( target, "click" ) ||
					nodeName( target, "a" );
			}
		},

		beforeunload: {
			postDispatch: function( event ) {

				// Support: Firefox 20+
				// Firefox doesn't alert if the returnValue field is not set.
				if ( event.result !== undefined && event.originalEvent ) {
					event.originalEvent.returnValue = event.result;
				}
			}
		}
	}
};

// Ensure the presence of an event listener that handles manually-triggered
// synthetic events by interrupting progress until reinvoked in response to
// *native* events that it fires directly, ensuring that state changes have
// already occurred before other listeners are invoked.
function leverageNative( el, type, expectSync ) {

	// Missing expectSync indicates a trigger call, which must force setup through jQuery.event.add
	if ( !expectSync ) {
		if ( dataPriv.get( el, type ) === undefined ) {
			jQuery.event.add( el, type, returnTrue );
		}
		return;
	}

	// Register the controller as a special universal handler for all event namespaces
	dataPriv.set( el, type, false );
	jQuery.event.add( el, type, {
		namespace: false,
		handler: function( event ) {
			var notAsync, result,
				saved = dataPriv.get( this, type );

			if ( ( event.isTrigger & 1 ) && this[ type ] ) {

				// Interrupt processing of the outer synthetic .trigger()ed event
				// Saved data should be false in such cases, but might be a leftover capture object
				// from an async native handler (gh-4350)
				if ( !saved.length ) {

					// Store arguments for use when handling the inner native event
					// There will always be at least one argument (an event object), so this array
					// will not be confused with a leftover capture object.
					saved = slice.call( arguments );
					dataPriv.set( this, type, saved );

					// Trigger the native event and capture its result
					// Support: IE <=9 - 11+
					// focus() and blur() are asynchronous
					notAsync = expectSync( this, type );
					this[ type ]();
					result = dataPriv.get( this, type );
					if ( saved !== result || notAsync ) {
						dataPriv.set( this, type, false );
					} else {
						result = {};
					}
					if ( saved !== result ) {

						// Cancel the outer synthetic event
						event.stopImmediatePropagation();
						event.preventDefault();
						return result.value;
					}

				// If this is an inner synthetic event for an event with a bubbling surrogate
				// (focus or blur), assume that the surrogate already propagated from triggering the
				// native event and prevent that from happening again here.
				// This technically gets the ordering wrong w.r.t. to `.trigger()` (in which the
				// bubbling surrogate propagates *after* the non-bubbling base), but that seems
				// less bad than duplication.
				} else if ( ( jQuery.event.special[ type ] || {} ).delegateType ) {
					event.stopPropagation();
				}

			// If this is a native event triggered above, everything is now in order
			// Fire an inner synthetic event with the original arguments
			} else if ( saved.length ) {

				// ...and capture the result
				dataPriv.set( this, type, {
					value: jQuery.event.trigger(

						// Support: IE <=9 - 11+
						// Extend with the prototype to reset the above stopImmediatePropagation()
						jQuery.extend( saved[ 0 ], jQuery.Event.prototype ),
						saved.slice( 1 ),
						this
					)
				} );

				// Abort handling of the native event
				event.stopImmediatePropagation();
			}
		}
	} );
}

jQuery.removeEvent = function( elem, type, handle ) {

	// This "if" is needed for plain objects
	if ( elem.removeEventListener ) {
		elem.removeEventListener( type, handle );
	}
};

jQuery.Event = function( src, props ) {

	// Allow instantiation without the 'new' keyword
	if ( !( this instanceof jQuery.Event ) ) {
		return new jQuery.Event( src, props );
	}

	// Event object
	if ( src && src.type ) {
		this.originalEvent = src;
		this.type = src.type;

		// Events bubbling up the document may have been marked as prevented
		// by a handler lower down the tree; reflect the correct value.
		this.isDefaultPrevented = src.defaultPrevented ||
				src.defaultPrevented === undefined &&

				// Support: Android <=2.3 only
				src.returnValue === false ?
			returnTrue :
			returnFalse;

		// Create target properties
		// Support: Safari <=6 - 7 only
		// Target should not be a text node (#504, #13143)
		this.target = ( src.target && src.target.nodeType === 3 ) ?
			src.target.parentNode :
			src.target;

		this.currentTarget = src.currentTarget;
		this.relatedTarget = src.relatedTarget;

	// Event type
	} else {
		this.type = src;
	}

	// Put explicitly provided properties onto the event object
	if ( props ) {
		jQuery.extend( this, props );
	}

	// Create a timestamp if incoming event doesn't have one
	this.timeStamp = src && src.timeStamp || Date.now();

	// Mark it as fixed
	this[ jQuery.expando ] = true;
};

// jQuery.Event is based on DOM3 Events as specified by the ECMAScript Language Binding
// https://www.w3.org/TR/2003/WD-DOM-Level-3-Events-20030331/ecma-script-binding.html
jQuery.Event.prototype = {
	constructor: jQuery.Event,
	isDefaultPrevented: returnFalse,
	isPropagationStopped: returnFalse,
	isImmediatePropagationStopped: returnFalse,
	isSimulated: false,

	preventDefault: function() {
		var e = this.originalEvent;

		this.isDefaultPrevented = returnTrue;

		if ( e && !this.isSimulated ) {
			e.preventDefault();
		}
	},
	stopPropagation: function() {
		var e = this.originalEvent;

		this.isPropagationStopped = returnTrue;

		if ( e && !this.isSimulated ) {
			e.stopPropagation();
		}
	},
	stopImmediatePropagation: function() {
		var e = this.originalEvent;

		this.isImmediatePropagationStopped = returnTrue;

		if ( e && !this.isSimulated ) {
			e.stopImmediatePropagation();
		}

		this.stopPropagation();
	}
};

// Includes all common event props including KeyEvent and MouseEvent specific props
jQuery.each( {
	altKey: true,
	bubbles: true,
	cancelable: true,
	changedTouches: true,
	ctrlKey: true,
	detail: true,
	eventPhase: true,
	metaKey: true,
	pageX: true,
	pageY: true,
	shiftKey: true,
	view: true,
	"char": true,
	code: true,
	charCode: true,
	key: true,
	keyCode: true,
	button: true,
	buttons: true,
	clientX: true,
	clientY: true,
	offsetX: true,
	offsetY: true,
	pointerId: true,
	pointerType: true,
	screenX: true,
	screenY: true,
	targetTouches: true,
	toElement: true,
	touches: true,

	which: function( event ) {
		var button = event.button;

		// Add which for key events
		if ( event.which == null && rkeyEvent.test( event.type ) ) {
			return event.charCode != null ? event.charCode : event.keyCode;
		}

		// Add which for click: 1 === left; 2 === middle; 3 === right
		if ( !event.which && button !== undefined && rmouseEvent.test( event.type ) ) {
			if ( button & 1 ) {
				return 1;
			}

			if ( button & 2 ) {
				return 3;
			}

			if ( button & 4 ) {
				return 2;
			}

			return 0;
		}

		return event.which;
	}
}, jQuery.event.addProp );

jQuery.each( { focus: "focusin", blur: "focusout" }, function( type, delegateType ) {
	jQuery.event.special[ type ] = {

		// Utilize native event if possible so blur/focus sequence is correct
		setup: function() {

			// Claim the first handler
			// dataPriv.set( this, "focus", ... )
			// dataPriv.set( this, "blur", ... )
			leverageNative( this, type, expectSync );

			// Return false to allow normal processing in the caller
			return false;
		},
		trigger: function() {

			// Force setup before trigger
			leverageNative( this, type );

			// Return non-false to allow normal event-path propagation
			return true;
		},

		delegateType: delegateType
	};
} );

// Create mouseenter/leave events using mouseover/out and event-time checks
// so that event delegation works in jQuery.
// Do the same for pointerenter/pointerleave and pointerover/pointerout
//
// Support: Safari 7 only
// Safari sends mouseenter too often; see:
// https://bugs.chromium.org/p/chromium/issues/detail?id=470258
// for the description of the bug (it existed in older Chrome versions as well).
jQuery.each( {
	mouseenter: "mouseover",
	mouseleave: "mouseout",
	pointerenter: "pointerover",
	pointerleave: "pointerout"
}, function( orig, fix ) {
	jQuery.event.special[ orig ] = {
		delegateType: fix,
		bindType: fix,

		handle: function( event ) {
			var ret,
				target = this,
				related = event.relatedTarget,
				handleObj = event.handleObj;

			// For mouseenter/leave call the handler if related is outside the target.
			// NB: No relatedTarget if the mouse left/entered the browser window
			if ( !related || ( related !== target && !jQuery.contains( target, related ) ) ) {
				event.type = handleObj.origType;
				ret = handleObj.handler.apply( this, arguments );
				event.type = fix;
			}
			return ret;
		}
	};
} );

jQuery.fn.extend( {

	on: function( types, selector, data, fn ) {
		return on( this, types, selector, data, fn );
	},
	one: function( types, selector, data, fn ) {
		return on( this, types, selector, data, fn, 1 );
	},
	off: function( types, selector, fn ) {
		var handleObj, type;
		if ( types && types.preventDefault && types.handleObj ) {

			// ( event )  dispatched jQuery.Event
			handleObj = types.handleObj;
			jQuery( types.delegateTarget ).off(
				handleObj.namespace ?
					handleObj.origType + "." + handleObj.namespace :
					handleObj.origType,
				handleObj.selector,
				handleObj.handler
			);
			return this;
		}
		if ( typeof types === "object" ) {

			// ( types-object [, selector] )
			for ( type in types ) {
				this.off( type, selector, types[ type ] );
			}
			return this;
		}
		if ( selector === false || typeof selector === "function" ) {

			// ( types [, fn] )
			fn = selector;
			selector = undefined;
		}
		if ( fn === false ) {
			fn = returnFalse;
		}
		return this.each( function() {
			jQuery.event.remove( this, types, fn, selector );
		} );
	}
} );


var

	// Support: IE <=10 - 11, Edge 12 - 13 only
	// In IE/Edge using regex groups here causes severe slowdowns.
	// See https://connect.microsoft.com/IE/feedback/details/1736512/
	rnoInnerhtml = /<script|<style|<link/i,

	// checked="checked" or checked
	rchecked = /checked\s*(?:[^=]|=\s*.checked.)/i,
	rcleanScript = /^\s*<!(?:\[CDATA\[|--)|(?:\]\]|--)>\s*$/g;

// Prefer a tbody over its parent table for containing new rows
function manipulationTarget( elem, content ) {
	if ( nodeName( elem, "table" ) &&
		nodeName( content.nodeType !== 11 ? content : content.firstChild, "tr" ) ) {

		return jQuery( elem ).children( "tbody" )[ 0 ] || elem;
	}

	return elem;
}

// Replace/restore the type attribute of script elements for safe DOM manipulation
function disableScript( elem ) {
	elem.type = ( elem.getAttribute( "type" ) !== null ) + "/" + elem.type;
	return elem;
}
function restoreScript( elem ) {
	if ( ( elem.type || "" ).slice( 0, 5 ) === "true/" ) {
		elem.type = elem.type.slice( 5 );
	} else {
		elem.removeAttribute( "type" );
	}

	return elem;
}

function cloneCopyEvent( src, dest ) {
	var i, l, type, pdataOld, udataOld, udataCur, events;

	if ( dest.nodeType !== 1 ) {
		return;
	}

	// 1. Copy private data: events, handlers, etc.
	if ( dataPriv.hasData( src ) ) {
		pdataOld = dataPriv.get( src );
		events = pdataOld.events;

		if ( events ) {
			dataPriv.remove( dest, "handle events" );

			for ( type in events ) {
				for ( i = 0, l = events[ type ].length; i < l; i++ ) {
					jQuery.event.add( dest, type, events[ type ][ i ] );
				}
			}
		}
	}

	// 2. Copy user data
	if ( dataUser.hasData( src ) ) {
		udataOld = dataUser.access( src );
		udataCur = jQuery.extend( {}, udataOld );

		dataUser.set( dest, udataCur );
	}
}

// Fix IE bugs, see support tests
function fixInput( src, dest ) {
	var nodeName = dest.nodeName.toLowerCase();

	// Fails to persist the checked state of a cloned checkbox or radio button.
	if ( nodeName === "input" && rcheckableType.test( src.type ) ) {
		dest.checked = src.checked;

	// Fails to return the selected option to the default selected state when cloning options
	} else if ( nodeName === "input" || nodeName === "textarea" ) {
		dest.defaultValue = src.defaultValue;
	}
}

function domManip( collection, args, callback, ignored ) {

	// Flatten any nested arrays
	args = flat( args );

	var fragment, first, scripts, hasScripts, node, doc,
		i = 0,
		l = collection.length,
		iNoClone = l - 1,
		value = args[ 0 ],
		valueIsFunction = isFunction( value );

	// We can't cloneNode fragments that contain checked, in WebKit
	if ( valueIsFunction ||
			( l > 1 && typeof value === "string" &&
				!support.checkClone && rchecked.test( value ) ) ) {
		return collection.each( function( index ) {
			var self = collection.eq( index );
			if ( valueIsFunction ) {
				args[ 0 ] = value.call( this, index, self.html() );
			}
			domManip( self, args, callback, ignored );
		} );
	}

	if ( l ) {
		fragment = buildFragment( args, collection[ 0 ].ownerDocument, false, collection, ignored );
		first = fragment.firstChild;

		if ( fragment.childNodes.length === 1 ) {
			fragment = first;
		}

		// Require either new content or an interest in ignored elements to invoke the callback
		if ( first || ignored ) {
			scripts = jQuery.map( getAll( fragment, "script" ), disableScript );
			hasScripts = scripts.length;

			// Use the original fragment for the last item
			// instead of the first because it can end up
			// being emptied incorrectly in certain situations (#8070).
			for ( ; i < l; i++ ) {
				node = fragment;

				if ( i !== iNoClone ) {
					node = jQuery.clone( node, true, true );

					// Keep references to cloned scripts for later restoration
					if ( hasScripts ) {

						// Support: Android <=4.0 only, PhantomJS 1 only
						// push.apply(_, arraylike) throws on ancient WebKit
						jQuery.merge( scripts, getAll( node, "script" ) );
					}
				}

				callback.call( collection[ i ], node, i );
			}

			if ( hasScripts ) {
				doc = scripts[ scripts.length - 1 ].ownerDocument;

				// Reenable scripts
				jQuery.map( scripts, restoreScript );

				// Evaluate executable scripts on first document insertion
				for ( i = 0; i < hasScripts; i++ ) {
					node = scripts[ i ];
					if ( rscriptType.test( node.type || "" ) &&
						!dataPriv.access( node, "globalEval" ) &&
						jQuery.contains( doc, node ) ) {

						if ( node.src && ( node.type || "" ).toLowerCase()  !== "module" ) {

							// Optional AJAX dependency, but won't run scripts if not present
							if ( jQuery._evalUrl && !node.noModule ) {
								jQuery._evalUrl( node.src, {
									nonce: node.nonce || node.getAttribute( "nonce" )
								}, doc );
							}
						} else {
							DOMEval( node.textContent.replace( rcleanScript, "" ), node, doc );
						}
					}
				}
			}
		}
	}

	return collection;
}

function remove( elem, selector, keepData ) {
	var node,
		nodes = selector ? jQuery.filter( selector, elem ) : elem,
		i = 0;

	for ( ; ( node = nodes[ i ] ) != null; i++ ) {
		if ( !keepData && node.nodeType === 1 ) {
			jQuery.cleanData( getAll( node ) );
		}

		if ( node.parentNode ) {
			if ( keepData && isAttached( node ) ) {
				setGlobalEval( getAll( node, "script" ) );
			}
			node.parentNode.removeChild( node );
		}
	}

	return elem;
}

jQuery.extend( {
	htmlPrefilter: function( html ) {
		return html;
	},

	clone: function( elem, dataAndEvents, deepDataAndEvents ) {
		var i, l, srcElements, destElements,
			clone = elem.cloneNode( true ),
			inPage = isAttached( elem );

		// Fix IE cloning issues
		if ( !support.noCloneChecked && ( elem.nodeType === 1 || elem.nodeType === 11 ) &&
				!jQuery.isXMLDoc( elem ) ) {

			// We eschew Sizzle here for performance reasons: https://jsperf.com/getall-vs-sizzle/2
			destElements = getAll( clone );
			srcElements = getAll( elem );

			for ( i = 0, l = srcElements.length; i < l; i++ ) {
				fixInput( srcElements[ i ], destElements[ i ] );
			}
		}

		// Copy the events from the original to the clone
		if ( dataAndEvents ) {
			if ( deepDataAndEvents ) {
				srcElements = srcElements || getAll( elem );
				destElements = destElements || getAll( clone );

				for ( i = 0, l = srcElements.length; i < l; i++ ) {
					cloneCopyEvent( srcElements[ i ], destElements[ i ] );
				}
			} else {
				cloneCopyEvent( elem, clone );
			}
		}

		// Preserve script evaluation history
		destElements = getAll( clone, "script" );
		if ( destElements.length > 0 ) {
			setGlobalEval( destElements, !inPage && getAll( elem, "script" ) );
		}

		// Return the cloned set
		return clone;
	},

	cleanData: function( elems ) {
		var data, elem, type,
			special = jQuery.event.special,
			i = 0;

		for ( ; ( elem = elems[ i ] ) !== undefined; i++ ) {
			if ( acceptData( elem ) ) {
				if ( ( data = elem[ dataPriv.expando ] ) ) {
					if ( data.events ) {
						for ( type in data.events ) {
							if ( special[ type ] ) {
								jQuery.event.remove( elem, type );

							// This is a shortcut to avoid jQuery.event.remove's overhead
							} else {
								jQuery.removeEvent( elem, type, data.handle );
							}
						}
					}

					// Support: Chrome <=35 - 45+
					// Assign undefined instead of using delete, see Data#remove
					elem[ dataPriv.expando ] = undefined;
				}
				if ( elem[ dataUser.expando ] ) {

					// Support: Chrome <=35 - 45+
					// Assign undefined instead of using delete, see Data#remove
					elem[ dataUser.expando ] = undefined;
				}
			}
		}
	}
} );

jQuery.fn.extend( {
	detach: function( selector ) {
		return remove( this, selector, true );
	},

	remove: function( selector ) {
		return remove( this, selector );
	},

	text: function( value ) {
		return access( this, function( value ) {
			return value === undefined ?
				jQuery.text( this ) :
				this.empty().each( function() {
					if ( this.nodeType === 1 || this.nodeType === 11 || this.nodeType === 9 ) {
						this.textContent = value;
					}
				} );
		}, null, value, arguments.length );
	},

	append: function() {
		return domManip( this, arguments, function( elem ) {
			if ( this.nodeType === 1 || this.nodeType === 11 || this.nodeType === 9 ) {
				var target = manipulationTarget( this, elem );
				target.appendChild( elem );
			}
		} );
	},

	prepend: function() {
		return domManip( this, arguments, function( elem ) {
			if ( this.nodeType === 1 || this.nodeType === 11 || this.nodeType === 9 ) {
				var target = manipulationTarget( this, elem );
				target.insertBefore( elem, target.firstChild );
			}
		} );
	},

	before: function() {
		return domManip( this, arguments, function( elem ) {
			if ( this.parentNode ) {
				this.parentNode.insertBefore( elem, this );
			}
		} );
	},

	after: function() {
		return domManip( this, arguments, function( elem ) {
			if ( this.parentNode ) {
				this.parentNode.insertBefore( elem, this.nextSibling );
			}
		} );
	},

	empty: function() {
		var elem,
			i = 0;

		for ( ; ( elem = this[ i ] ) != null; i++ ) {
			if ( elem.nodeType === 1 ) {

				// Prevent memory leaks
				jQuery.cleanData( getAll( elem, false ) );

				// Remove any remaining nodes
				elem.textContent = "";
			}
		}

		return this;
	},

	clone: function( dataAndEvents, deepDataAndEvents ) {
		dataAndEvents = dataAndEvents == null ? false : dataAndEvents;
		deepDataAndEvents = deepDataAndEvents == null ? dataAndEvents : deepDataAndEvents;

		return this.map( function() {
			return jQuery.clone( this, dataAndEvents, deepDataAndEvents );
		} );
	},

	html: function( value ) {
		return access( this, function( value ) {
			var elem = this[ 0 ] || {},
				i = 0,
				l = this.length;

			if ( value === undefined && elem.nodeType === 1 ) {
				return elem.innerHTML;
			}

			// See if we can take a shortcut and just use innerHTML
			if ( typeof value === "string" && !rnoInnerhtml.test( value ) &&
				!wrapMap[ ( rtagName.exec( value ) || [ "", "" ] )[ 1 ].toLowerCase() ] ) {

				value = jQuery.htmlPrefilter( value );

				try {
					for ( ; i < l; i++ ) {
						elem = this[ i ] || {};

						// Remove element nodes and prevent memory leaks
						if ( elem.nodeType === 1 ) {
							jQuery.cleanData( getAll( elem, false ) );
							elem.innerHTML = value;
						}
					}

					elem = 0;

				// If using innerHTML throws an exception, use the fallback method
				} catch ( e ) {}
			}

			if ( elem ) {
				this.empty().append( value );
			}
		}, null, value, arguments.length );
	},

	replaceWith: function() {
		var ignored = [];

		// Make the changes, replacing each non-ignored context element with the new content
		return domManip( this, arguments, function( elem ) {
			var parent = this.parentNode;

			if ( jQuery.inArray( this, ignored ) < 0 ) {
				jQuery.cleanData( getAll( this ) );
				if ( parent ) {
					parent.replaceChild( elem, this );
				}
			}

		// Force callback invocation
		}, ignored );
	}
} );

jQuery.each( {
	appendTo: "append",
	prependTo: "prepend",
	insertBefore: "before",
	insertAfter: "after",
	replaceAll: "replaceWith"
}, function( name, original ) {
	jQuery.fn[ name ] = function( selector ) {
		var elems,
			ret = [],
			insert = jQuery( selector ),
			last = insert.length - 1,
			i = 0;

		for ( ; i <= last; i++ ) {
			elems = i === last ? this : this.clone( true );
			jQuery( insert[ i ] )[ original ]( elems );

			// Support: Android <=4.0 only, PhantomJS 1 only
			// .get() because push.apply(_, arraylike) throws on ancient WebKit
			push.apply( ret, elems.get() );
		}

		return this.pushStack( ret );
	};
} );
var rnumnonpx = new RegExp( "^(" + pnum + ")(?!px)[a-z%]+$", "i" );

var getStyles = function( elem ) {

		// Support: IE <=11 only, Firefox <=30 (#15098, #14150)
		// IE throws on elements created in popups
		// FF meanwhile throws on frame elements through "defaultView.getComputedStyle"
		var view = elem.ownerDocument.defaultView;

		if ( !view || !view.opener ) {
			view = window;
		}

		return view.getComputedStyle( elem );
	};

var swap = function( elem, options, callback ) {
	var ret, name,
		old = {};

	// Remember the old values, and insert the new ones
	for ( name in options ) {
		old[ name ] = elem.style[ name ];
		elem.style[ name ] = options[ name ];
	}

	ret = callback.call( elem );

	// Revert the old values
	for ( name in options ) {
		elem.style[ name ] = old[ name ];
	}

	return ret;
};


var rboxStyle = new RegExp( cssExpand.join( "|" ), "i" );



( function() {

	// Executing both pixelPosition & boxSizingReliable tests require only one layout
	// so they're executed at the same time to save the second computation.
	function computeStyleTests() {

		// This is a singleton, we need to execute it only once
		if ( !div ) {
			return;
		}

		container.style.cssText = "position:absolute;left:-11111px;width:60px;" +
			"margin-top:1px;padding:0;border:0";
		div.style.cssText =
			"position:relative;display:block;box-sizing:border-box;overflow:scroll;" +
			"margin:auto;border:1px;padding:1px;" +
			"width:60%;top:1%";
		documentElement.appendChild( container ).appendChild( div );

		var divStyle = window.getComputedStyle( div );
		pixelPositionVal = divStyle.top !== "1%";

		// Support: Android 4.0 - 4.3 only, Firefox <=3 - 44
		reliableMarginLeftVal = roundPixelMeasures( divStyle.marginLeft ) === 12;

		// Support: Android 4.0 - 4.3 only, Safari <=9.1 - 10.1, iOS <=7.0 - 9.3
		// Some styles come back with percentage values, even though they shouldn't
		div.style.right = "60%";
		pixelBoxStylesVal = roundPixelMeasures( divStyle.right ) === 36;

		// Support: IE 9 - 11 only
		// Detect misreporting of content dimensions for box-sizing:border-box elements
		boxSizingReliableVal = roundPixelMeasures( divStyle.width ) === 36;

		// Support: IE 9 only
		// Detect overflow:scroll screwiness (gh-3699)
		// Support: Chrome <=64
		// Don't get tricked when zoom affects offsetWidth (gh-4029)
		div.style.position = "absolute";
		scrollboxSizeVal = roundPixelMeasures( div.offsetWidth / 3 ) === 12;

		documentElement.removeChild( container );

		// Nullify the div so it wouldn't be stored in the memory and
		// it will also be a sign that checks already performed
		div = null;
	}

	function roundPixelMeasures( measure ) {
		return Math.round( parseFloat( measure ) );
	}

	var pixelPositionVal, boxSizingReliableVal, scrollboxSizeVal, pixelBoxStylesVal,
		reliableTrDimensionsVal, reliableMarginLeftVal,
		container = document.createElement( "div" ),
		div = document.createElement( "div" );

	// Finish early in limited (non-browser) environments
	if ( !div.style ) {
		return;
	}

	// Support: IE <=9 - 11 only
	// Style of cloned element affects source element cloned (#8908)
	div.style.backgroundClip = "content-box";
	div.cloneNode( true ).style.backgroundClip = "";
	support.clearCloneStyle = div.style.backgroundClip === "content-box";

	jQuery.extend( support, {
		boxSizingReliable: function() {
			computeStyleTests();
			return boxSizingReliableVal;
		},
		pixelBoxStyles: function() {
			computeStyleTests();
			return pixelBoxStylesVal;
		},
		pixelPosition: function() {
			computeStyleTests();
			return pixelPositionVal;
		},
		reliableMarginLeft: function() {
			computeStyleTests();
			return reliableMarginLeftVal;
		},
		scrollboxSize: function() {
			computeStyleTests();
			return scrollboxSizeVal;
		},

		// Support: IE 9 - 11+, Edge 15 - 18+
		// IE/Edge misreport `getComputedStyle` of table rows with width/height
		// set in CSS while `offset*` properties report correct values.
		// Behavior in IE 9 is more subtle than in newer versions & it passes
		// some versions of this test; make sure not to make it pass there!
		reliableTrDimensions: function() {
			var table, tr, trChild, trStyle;
			if ( reliableTrDimensionsVal == null ) {
				table = document.createElement( "table" );
				tr = document.createElement( "tr" );
				trChild = document.createElement( "div" );

				table.style.cssText = "position:absolute;left:-11111px";
				tr.style.height = "1px";
				trChild.style.height = "9px";

				documentElement
					.appendChild( table )
					.appendChild( tr )
					.appendChild( trChild );

				trStyle = window.getComputedStyle( tr );
				reliableTrDimensionsVal = parseInt( trStyle.height ) > 3;

				documentElement.removeChild( table );
			}
			return reliableTrDimensionsVal;
		}
	} );
} )();


function curCSS( elem, name, computed ) {
	var width, minWidth, maxWidth, ret,

		// Support: Firefox 51+
		// Retrieving style before computed somehow
		// fixes an issue with getting wrong values
		// on detached elements
		style = elem.style;

	computed = computed || getStyles( elem );

	// getPropertyValue is needed for:
	//   .css('filter') (IE 9 only, #12537)
	//   .css('--customProperty) (#3144)
	if ( computed ) {
		ret = computed.getPropertyValue( name ) || computed[ name ];

		if ( ret === "" && !isAttached( elem ) ) {
			ret = jQuery.style( elem, name );
		}

		// A tribute to the "awesome hack by Dean Edwards"
		// Android Browser returns percentage for some values,
		// but width seems to be reliably pixels.
		// This is against the CSSOM draft spec:
		// https://drafts.csswg.org/cssom/#resolved-values
		if ( !support.pixelBoxStyles() && rnumnonpx.test( ret ) && rboxStyle.test( name ) ) {

			// Remember the original values
			width = style.width;
			minWidth = style.minWidth;
			maxWidth = style.maxWidth;

			// Put in the new values to get a computed value out
			style.minWidth = style.maxWidth = style.width = ret;
			ret = computed.width;

			// Revert the changed values
			style.width = width;
			style.minWidth = minWidth;
			style.maxWidth = maxWidth;
		}
	}

	return ret !== undefined ?

		// Support: IE <=9 - 11 only
		// IE returns zIndex value as an integer.
		ret + "" :
		ret;
}


function addGetHookIf( conditionFn, hookFn ) {

	// Define the hook, we'll check on the first run if it's really needed.
	return {
		get: function() {
			if ( conditionFn() ) {

				// Hook not needed (or it's not possible to use it due
				// to missing dependency), remove it.
				delete this.get;
				return;
			}

			// Hook needed; redefine it so that the support test is not executed again.
			return ( this.get = hookFn ).apply( this, arguments );
		}
	};
}


var cssPrefixes = [ "Webkit", "Moz", "ms" ],
	emptyStyle = document.createElement( "div" ).style,
	vendorProps = {};

// Return a vendor-prefixed property or undefined
function vendorPropName( name ) {

	// Check for vendor prefixed names
	var capName = name[ 0 ].toUpperCase() + name.slice( 1 ),
		i = cssPrefixes.length;

	while ( i-- ) {
		name = cssPrefixes[ i ] + capName;
		if ( name in emptyStyle ) {
			return name;
		}
	}
}

// Return a potentially-mapped jQuery.cssProps or vendor prefixed property
function finalPropName( name ) {
	var final = jQuery.cssProps[ name ] || vendorProps[ name ];

	if ( final ) {
		return final;
	}
	if ( name in emptyStyle ) {
		return name;
	}
	return vendorProps[ name ] = vendorPropName( name ) || name;
}


var

	// Swappable if display is none or starts with table
	// except "table", "table-cell", or "table-caption"
	// See here for display values: https://developer.mozilla.org/en-US/docs/CSS/display
	rdisplayswap = /^(none|table(?!-c[ea]).+)/,
	rcustomProp = /^--/,
	cssShow = { position: "absolute", visibility: "hidden", display: "block" },
	cssNormalTransform = {
		letterSpacing: "0",
		fontWeight: "400"
	};

function setPositiveNumber( _elem, value, subtract ) {

	// Any relative (+/-) values have already been
	// normalized at this point
	var matches = rcssNum.exec( value );
	return matches ?

		// Guard against undefined "subtract", e.g., when used as in cssHooks
		Math.max( 0, matches[ 2 ] - ( subtract || 0 ) ) + ( matches[ 3 ] || "px" ) :
		value;
}

function boxModelAdjustment( elem, dimension, box, isBorderBox, styles, computedVal ) {
	var i = dimension === "width" ? 1 : 0,
		extra = 0,
		delta = 0;

	// Adjustment may not be necessary
	if ( box === ( isBorderBox ? "border" : "content" ) ) {
		return 0;
	}

	for ( ; i < 4; i += 2 ) {

		// Both box models exclude margin
		if ( box === "margin" ) {
			delta += jQuery.css( elem, box + cssExpand[ i ], true, styles );
		}

		// If we get here with a content-box, we're seeking "padding" or "border" or "margin"
		if ( !isBorderBox ) {

			// Add padding
			delta += jQuery.css( elem, "padding" + cssExpand[ i ], true, styles );

			// For "border" or "margin", add border
			if ( box !== "padding" ) {
				delta += jQuery.css( elem, "border" + cssExpand[ i ] + "Width", true, styles );

			// But still keep track of it otherwise
			} else {
				extra += jQuery.css( elem, "border" + cssExpand[ i ] + "Width", true, styles );
			}

		// If we get here with a border-box (content + padding + border), we're seeking "content" or
		// "padding" or "margin"
		} else {

			// For "content", subtract padding
			if ( box === "content" ) {
				delta -= jQuery.css( elem, "padding" + cssExpand[ i ], true, styles );
			}

			// For "content" or "padding", subtract border
			if ( box !== "margin" ) {
				delta -= jQuery.css( elem, "border" + cssExpand[ i ] + "Width", true, styles );
			}
		}
	}

	// Account for positive content-box scroll gutter when requested by providing computedVal
	if ( !isBorderBox && computedVal >= 0 ) {

		// offsetWidth/offsetHeight is a rounded sum of content, padding, scroll gutter, and border
		// Assuming integer scroll gutter, subtract the rest and round down
		delta += Math.max( 0, Math.ceil(
			elem[ "offset" + dimension[ 0 ].toUpperCase() + dimension.slice( 1 ) ] -
			computedVal -
			delta -
			extra -
			0.5

		// If offsetWidth/offsetHeight is unknown, then we can't determine content-box scroll gutter
		// Use an explicit zero to avoid NaN (gh-3964)
		) ) || 0;
	}

	return delta;
}

function getWidthOrHeight( elem, dimension, extra ) {

	// Start with computed style
	var styles = getStyles( elem ),

		// To avoid forcing a reflow, only fetch boxSizing if we need it (gh-4322).
		// Fake content-box until we know it's needed to know the true value.
		boxSizingNeeded = !support.boxSizingReliable() || extra,
		isBorderBox = boxSizingNeeded &&
			jQuery.css( elem, "boxSizing", false, styles ) === "border-box",
		valueIsBorderBox = isBorderBox,

		val = curCSS( elem, dimension, styles ),
		offsetProp = "offset" + dimension[ 0 ].toUpperCase() + dimension.slice( 1 );

	// Support: Firefox <=54
	// Return a confounding non-pixel value or feign ignorance, as appropriate.
	if ( rnumnonpx.test( val ) ) {
		if ( !extra ) {
			return val;
		}
		val = "auto";
	}


	// Support: IE 9 - 11 only
	// Use offsetWidth/offsetHeight for when box sizing is unreliable.
	// In those cases, the computed value can be trusted to be border-box.
	if ( ( !support.boxSizingReliable() && isBorderBox ||

		// Support: IE 10 - 11+, Edge 15 - 18+
		// IE/Edge misreport `getComputedStyle` of table rows with width/height
		// set in CSS while `offset*` properties report correct values.
		// Interestingly, in some cases IE 9 doesn't suffer from this issue.
		!support.reliableTrDimensions() && nodeName( elem, "tr" ) ||

		// Fall back to offsetWidth/offsetHeight when value is "auto"
		// This happens for inline elements with no explicit setting (gh-3571)
		val === "auto" ||

		// Support: Android <=4.1 - 4.3 only
		// Also use offsetWidth/offsetHeight for misreported inline dimensions (gh-3602)
		!parseFloat( val ) && jQuery.css( elem, "display", false, styles ) === "inline" ) &&

		// Make sure the element is visible & connected
		elem.getClientRects().length ) {

		isBorderBox = jQuery.css( elem, "boxSizing", false, styles ) === "border-box";

		// Where available, offsetWidth/offsetHeight approximate border box dimensions.
		// Where not available (e.g., SVG), assume unreliable box-sizing and interpret the
		// retrieved value as a content box dimension.
		valueIsBorderBox = offsetProp in elem;
		if ( valueIsBorderBox ) {
			val = elem[ offsetProp ];
		}
	}

	// Normalize "" and auto
	val = parseFloat( val ) || 0;

	// Adjust for the element's box model
	return ( val +
		boxModelAdjustment(
			elem,
			dimension,
			extra || ( isBorderBox ? "border" : "content" ),
			valueIsBorderBox,
			styles,

			// Provide the current computed size to request scroll gutter calculation (gh-3589)
			val
		)
	) + "px";
}

jQuery.extend( {

	// Add in style property hooks for overriding the default
	// behavior of getting and setting a style property
	cssHooks: {
		opacity: {
			get: function( elem, computed ) {
				if ( computed ) {

					// We should always get a number back from opacity
					var ret = curCSS( elem, "opacity" );
					return ret === "" ? "1" : ret;
				}
			}
		}
	},

	// Don't automatically add "px" to these possibly-unitless properties
	cssNumber: {
		"animationIterationCount": true,
		"columnCount": true,
		"fillOpacity": true,
		"flexGrow": true,
		"flexShrink": true,
		"fontWeight": true,
		"gridArea": true,
		"gridColumn": true,
		"gridColumnEnd": true,
		"gridColumnStart": true,
		"gridRow": true,
		"gridRowEnd": true,
		"gridRowStart": true,
		"lineHeight": true,
		"opacity": true,
		"order": true,
		"orphans": true,
		"widows": true,
		"zIndex": true,
		"zoom": true
	},

	// Add in properties whose names you wish to fix before
	// setting or getting the value
	cssProps: {},

	// Get and set the style property on a DOM Node
	style: function( elem, name, value, extra ) {

		// Don't set styles on text and comment nodes
		if ( !elem || elem.nodeType === 3 || elem.nodeType === 8 || !elem.style ) {
			return;
		}

		// Make sure that we're working with the right name
		var ret, type, hooks,
			origName = camelCase( name ),
			isCustomProp = rcustomProp.test( name ),
			style = elem.style;

		// Make sure that we're working with the right name. We don't
		// want to query the value if it is a CSS custom property
		// since they are user-defined.
		if ( !isCustomProp ) {
			name = finalPropName( origName );
		}

		// Gets hook for the prefixed version, then unprefixed version
		hooks = jQuery.cssHooks[ name ] || jQuery.cssHooks[ origName ];

		// Check if we're setting a value
		if ( value !== undefined ) {
			type = typeof value;

			// Convert "+=" or "-=" to relative numbers (#7345)
			if ( type === "string" && ( ret = rcssNum.exec( value ) ) && ret[ 1 ] ) {
				value = adjustCSS( elem, name, ret );

				// Fixes bug #9237
				type = "number";
			}

			// Make sure that null and NaN values aren't set (#7116)
			if ( value == null || value !== value ) {
				return;
			}

			// If a number was passed in, add the unit (except for certain CSS properties)
			// The isCustomProp check can be removed in jQuery 4.0 when we only auto-append
			// "px" to a few hardcoded values.
			if ( type === "number" && !isCustomProp ) {
				value += ret && ret[ 3 ] || ( jQuery.cssNumber[ origName ] ? "" : "px" );
			}

			// background-* props affect original clone's values
			if ( !support.clearCloneStyle && value === "" && name.indexOf( "background" ) === 0 ) {
				style[ name ] = "inherit";
			}

			// If a hook was provided, use that value, otherwise just set the specified value
			if ( !hooks || !( "set" in hooks ) ||
				( value = hooks.set( elem, value, extra ) ) !== undefined ) {

				if ( isCustomProp ) {
					style.setProperty( name, value );
				} else {
					style[ name ] = value;
				}
			}

		} else {

			// If a hook was provided get the non-computed value from there
			if ( hooks && "get" in hooks &&
				( ret = hooks.get( elem, false, extra ) ) !== undefined ) {

				return ret;
			}

			// Otherwise just get the value from the style object
			return style[ name ];
		}
	},

	css: function( elem, name, extra, styles ) {
		var val, num, hooks,
			origName = camelCase( name ),
			isCustomProp = rcustomProp.test( name );

		// Make sure that we're working with the right name. We don't
		// want to modify the value if it is a CSS custom property
		// since they are user-defined.
		if ( !isCustomProp ) {
			name = finalPropName( origName );
		}

		// Try prefixed name followed by the unprefixed name
		hooks = jQuery.cssHooks[ name ] || jQuery.cssHooks[ origName ];

		// If a hook was provided get the computed value from there
		if ( hooks && "get" in hooks ) {
			val = hooks.get( elem, true, extra );
		}

		// Otherwise, if a way to get the computed value exists, use that
		if ( val === undefined ) {
			val = curCSS( elem, name, styles );
		}

		// Convert "normal" to computed value
		if ( val === "normal" && name in cssNormalTransform ) {
			val = cssNormalTransform[ name ];
		}

		// Make numeric if forced or a qualifier was provided and val looks numeric
		if ( extra === "" || extra ) {
			num = parseFloat( val );
			return extra === true || isFinite( num ) ? num || 0 : val;
		}

		return val;
	}
} );

jQuery.each( [ "height", "width" ], function( _i, dimension ) {
	jQuery.cssHooks[ dimension ] = {
		get: function( elem, computed, extra ) {
			if ( computed ) {

				// Certain elements can have dimension info if we invisibly show them
				// but it must have a current display style that would benefit
				return rdisplayswap.test( jQuery.css( elem, "display" ) ) &&

					// Support: Safari 8+
					// Table columns in Safari have non-zero offsetWidth & zero
					// getBoundingClientRect().width unless display is changed.
					// Support: IE <=11 only
					// Running getBoundingClientRect on a disconnected node
					// in IE throws an error.
					( !elem.getClientRects().length || !elem.getBoundingClientRect().width ) ?
						swap( elem, cssShow, function() {
							return getWidthOrHeight( elem, dimension, extra );
						} ) :
						getWidthOrHeight( elem, dimension, extra );
			}
		},

		set: function( elem, value, extra ) {
			var matches,
				styles = getStyles( elem ),

				// Only read styles.position if the test has a chance to fail
				// to avoid forcing a reflow.
				scrollboxSizeBuggy = !support.scrollboxSize() &&
					styles.position === "absolute",

				// To avoid forcing a reflow, only fetch boxSizing if we need it (gh-3991)
				boxSizingNeeded = scrollboxSizeBuggy || extra,
				isBorderBox = boxSizingNeeded &&
					jQuery.css( elem, "boxSizing", false, styles ) === "border-box",
				subtract = extra ?
					boxModelAdjustment(
						elem,
						dimension,
						extra,
						isBorderBox,
						styles
					) :
					0;

			// Account for unreliable border-box dimensions by comparing offset* to computed and
			// faking a content-box to get border and padding (gh-3699)
			if ( isBorderBox && scrollboxSizeBuggy ) {
				subtract -= Math.ceil(
					elem[ "offset" + dimension[ 0 ].toUpperCase() + dimension.slice( 1 ) ] -
					parseFloat( styles[ dimension ] ) -
					boxModelAdjustment( elem, dimension, "border", false, styles ) -
					0.5
				);
			}

			// Convert to pixels if value adjustment is needed
			if ( subtract && ( matches = rcssNum.exec( value ) ) &&
				( matches[ 3 ] || "px" ) !== "px" ) {

				elem.style[ dimension ] = value;
				value = jQuery.css( elem, dimension );
			}

			return setPositiveNumber( elem, value, subtract );
		}
	};
} );

jQuery.cssHooks.marginLeft = addGetHookIf( support.reliableMarginLeft,
	function( elem, computed ) {
		if ( computed ) {
			return ( parseFloat( curCSS( elem, "marginLeft" ) ) ||
				elem.getBoundingClientRect().left -
					swap( elem, { marginLeft: 0 }, function() {
						return elem.getBoundingClientRect().left;
					} )
				) + "px";
		}
	}
);

// These hooks are used by animate to expand properties
jQuery.each( {
	margin: "",
	padding: "",
	border: "Width"
}, function( prefix, suffix ) {
	jQuery.cssHooks[ prefix + suffix ] = {
		expand: function( value ) {
			var i = 0,
				expanded = {},

				// Assumes a single number if not a string
				parts = typeof value === "string" ? value.split( " " ) : [ value ];

			for ( ; i < 4; i++ ) {
				expanded[ prefix + cssExpand[ i ] + suffix ] =
					parts[ i ] || parts[ i - 2 ] || parts[ 0 ];
			}

			return expanded;
		}
	};

	if ( prefix !== "margin" ) {
		jQuery.cssHooks[ prefix + suffix ].set = setPositiveNumber;
	}
} );

jQuery.fn.extend( {
	css: function( name, value ) {
		return access( this, function( elem, name, value ) {
			var styles, len,
				map = {},
				i = 0;

			if ( Array.isArray( name ) ) {
				styles = getStyles( elem );
				len = name.length;

				for ( ; i < len; i++ ) {
					map[ name[ i ] ] = jQuery.css( elem, name[ i ], false, styles );
				}

				return map;
			}

			return value !== undefined ?
				jQuery.style( elem, name, value ) :
				jQuery.css( elem, name );
		}, name, value, arguments.length > 1 );
	}
} );


function Tween( elem, options, prop, end, easing ) {
	return new Tween.prototype.init( elem, options, prop, end, easing );
}
jQuery.Tween = Tween;

Tween.prototype = {
	constructor: Tween,
	init: function( elem, options, prop, end, easing, unit ) {
		this.elem = elem;
		this.prop = prop;
		this.easing = easing || jQuery.easing._default;
		this.options = options;
		this.start = this.now = this.cur();
		this.end = end;
		this.unit = unit || ( jQuery.cssNumber[ prop ] ? "" : "px" );
	},
	cur: function() {
		var hooks = Tween.propHooks[ this.prop ];

		return hooks && hooks.get ?
			hooks.get( this ) :
			Tween.propHooks._default.get( this );
	},
	run: function( percent ) {
		var eased,
			hooks = Tween.propHooks[ this.prop ];

		if ( this.options.duration ) {
			this.pos = eased = jQuery.easing[ this.easing ](
				percent, this.options.duration * percent, 0, 1, this.options.duration
			);
		} else {
			this.pos = eased = percent;
		}
		this.now = ( this.end - this.start ) * eased + this.start;

		if ( this.options.step ) {
			this.options.step.call( this.elem, this.now, this );
		}

		if ( hooks && hooks.set ) {
			hooks.set( this );
		} else {
			Tween.propHooks._default.set( this );
		}
		return this;
	}
};

Tween.prototype.init.prototype = Tween.prototype;

Tween.propHooks = {
	_default: {
		get: function( tween ) {
			var result;

			// Use a property on the element directly when it is not a DOM element,
			// or when there is no matching style property that exists.
			if ( tween.elem.nodeType !== 1 ||
				tween.elem[ tween.prop ] != null && tween.elem.style[ tween.prop ] == null ) {
				return tween.elem[ tween.prop ];
			}

			// Passing an empty string as a 3rd parameter to .css will automatically
			// attempt a parseFloat and fallback to a string if the parse fails.
			// Simple values such as "10px" are parsed to Float;
			// complex values such as "rotate(1rad)" are returned as-is.
			result = jQuery.css( tween.elem, tween.prop, "" );

			// Empty strings, null, undefined and "auto" are converted to 0.
			return !result || result === "auto" ? 0 : result;
		},
		set: function( tween ) {

			// Use step hook for back compat.
			// Use cssHook if its there.
			// Use .style if available and use plain properties where available.
			if ( jQuery.fx.step[ tween.prop ] ) {
				jQuery.fx.step[ tween.prop ]( tween );
			} else if ( tween.elem.nodeType === 1 && (
					jQuery.cssHooks[ tween.prop ] ||
					tween.elem.style[ finalPropName( tween.prop ) ] != null ) ) {
				jQuery.style( tween.elem, tween.prop, tween.now + tween.unit );
			} else {
				tween.elem[ tween.prop ] = tween.now;
			}
		}
	}
};

// Support: IE <=9 only
// Panic based approach to setting things on disconnected nodes
Tween.propHooks.scrollTop = Tween.propHooks.scrollLeft = {
	set: function( tween ) {
		if ( tween.elem.nodeType && tween.elem.parentNode ) {
			tween.elem[ tween.prop ] = tween.now;
		}
	}
};

jQuery.easing = {
	linear: function( p ) {
		return p;
	},
	swing: function( p ) {
		return 0.5 - Math.cos( p * Math.PI ) / 2;
	},
	_default: "swing"
};

jQuery.fx = Tween.prototype.init;

// Back compat <1.8 extension point
jQuery.fx.step = {};




var
	fxNow, inProgress,
	rfxtypes = /^(?:toggle|show|hide)$/,
	rrun = /queueHooks$/;

function schedule() {
	if ( inProgress ) {
		if ( document.hidden === false && window.requestAnimationFrame ) {
			window.requestAnimationFrame( schedule );
		} else {
			window.setTimeout( schedule, jQuery.fx.interval );
		}

		jQuery.fx.tick();
	}
}

// Animations created synchronously will run synchronously
function createFxNow() {
	window.setTimeout( function() {
		fxNow = undefined;
	} );
	return ( fxNow = Date.now() );
}

// Generate parameters to create a standard animation
function genFx( type, includeWidth ) {
	var which,
		i = 0,
		attrs = { height: type };

	// If we include width, step value is 1 to do all cssExpand values,
	// otherwise step value is 2 to skip over Left and Right
	includeWidth = includeWidth ? 1 : 0;
	for ( ; i < 4; i += 2 - includeWidth ) {
		which = cssExpand[ i ];
		attrs[ "margin" + which ] = attrs[ "padding" + which ] = type;
	}

	if ( includeWidth ) {
		attrs.opacity = attrs.width = type;
	}

	return attrs;
}

function createTween( value, prop, animation ) {
	var tween,
		collection = ( Animation.tweeners[ prop ] || [] ).concat( Animation.tweeners[ "*" ] ),
		index = 0,
		length = collection.length;
	for ( ; index < length; index++ ) {
		if ( ( tween = collection[ index ].call( animation, prop, value ) ) ) {

			// We're done with this property
			return tween;
		}
	}
}

function defaultPrefilter( elem, props, opts ) {
	var prop, value, toggle, hooks, oldfire, propTween, restoreDisplay, display,
		isBox = "width" in props || "height" in props,
		anim = this,
		orig = {},
		style = elem.style,
		hidden = elem.nodeType && isHiddenWithinTree( elem ),
		dataShow = dataPriv.get( elem, "fxshow" );

	// Queue-skipping animations hijack the fx hooks
	if ( !opts.queue ) {
		hooks = jQuery._queueHooks( elem, "fx" );
		if ( hooks.unqueued == null ) {
			hooks.unqueued = 0;
			oldfire = hooks.empty.fire;
			hooks.empty.fire = function() {
				if ( !hooks.unqueued ) {
					oldfire();
				}
			};
		}
		hooks.unqueued++;

		anim.always( function() {

			// Ensure the complete handler is called before this completes
			anim.always( function() {
				hooks.unqueued--;
				if ( !jQuery.queue( elem, "fx" ).length ) {
					hooks.empty.fire();
				}
			} );
		} );
	}

	// Detect show/hide animations
	for ( prop in props ) {
		value = props[ prop ];
		if ( rfxtypes.test( value ) ) {
			delete props[ prop ];
			toggle = toggle || value === "toggle";
			if ( value === ( hidden ? "hide" : "show" ) ) {

				// Pretend to be hidden if this is a "show" and
				// there is still data from a stopped show/hide
				if ( value === "show" && dataShow && dataShow[ prop ] !== undefined ) {
					hidden = true;

				// Ignore all other no-op show/hide data
				} else {
					continue;
				}
			}
			orig[ prop ] = dataShow && dataShow[ prop ] || jQuery.style( elem, prop );
		}
	}

	// Bail out if this is a no-op like .hide().hide()
	propTween = !jQuery.isEmptyObject( props );
	if ( !propTween && jQuery.isEmptyObject( orig ) ) {
		return;
	}

	// Restrict "overflow" and "display" styles during box animations
	if ( isBox && elem.nodeType === 1 ) {

		// Support: IE <=9 - 11, Edge 12 - 15
		// Record all 3 overflow attributes because IE does not infer the shorthand
		// from identically-valued overflowX and overflowY and Edge just mirrors
		// the overflowX value there.
		opts.overflow = [ style.overflow, style.overflowX, style.overflowY ];

		// Identify a display type, preferring old show/hide data over the CSS cascade
		restoreDisplay = dataShow && dataShow.display;
		if ( restoreDisplay == null ) {
			restoreDisplay = dataPriv.get( elem, "display" );
		}
		display = jQuery.css( elem, "display" );
		if ( display === "none" ) {
			if ( restoreDisplay ) {
				display = restoreDisplay;
			} else {

				// Get nonempty value(s) by temporarily forcing visibility
				showHide( [ elem ], true );
				restoreDisplay = elem.style.display || restoreDisplay;
				display = jQuery.css( elem, "display" );
				showHide( [ elem ] );
			}
		}

		// Animate inline elements as inline-block
		if ( display === "inline" || display === "inline-block" && restoreDisplay != null ) {
			if ( jQuery.css( elem, "float" ) === "none" ) {

				// Restore the original display value at the end of pure show/hide animations
				if ( !propTween ) {
					anim.done( function() {
						style.display = restoreDisplay;
					} );
					if ( restoreDisplay == null ) {
						display = style.display;
						restoreDisplay = display === "none" ? "" : display;
					}
				}
				style.display = "inline-block";
			}
		}
	}

	if ( opts.overflow ) {
		style.overflow = "hidden";
		anim.always( function() {
			style.overflow = opts.overflow[ 0 ];
			style.overflowX = opts.overflow[ 1 ];
			style.overflowY = opts.overflow[ 2 ];
		} );
	}

	// Implement show/hide animations
	propTween = false;
	for ( prop in orig ) {

		// General show/hide setup for this element animation
		if ( !propTween ) {
			if ( dataShow ) {
				if ( "hidden" in dataShow ) {
					hidden = dataShow.hidden;
				}
			} else {
				dataShow = dataPriv.access( elem, "fxshow", { display: restoreDisplay } );
			}

			// Store hidden/visible for toggle so `.stop().toggle()` "reverses"
			if ( toggle ) {
				dataShow.hidden = !hidden;
			}

			// Show elements before animating them
			if ( hidden ) {
				showHide( [ elem ], true );
			}

			/* eslint-disable no-loop-func */

			anim.done( function() {

			/* eslint-enable no-loop-func */

				// The final step of a "hide" animation is actually hiding the element
				if ( !hidden ) {
					showHide( [ elem ] );
				}
				dataPriv.remove( elem, "fxshow" );
				for ( prop in orig ) {
					jQuery.style( elem, prop, orig[ prop ] );
				}
			} );
		}

		// Per-property setup
		propTween = createTween( hidden ? dataShow[ prop ] : 0, prop, anim );
		if ( !( prop in dataShow ) ) {
			dataShow[ prop ] = propTween.start;
			if ( hidden ) {
				propTween.end = propTween.start;
				propTween.start = 0;
			}
		}
	}
}

function propFilter( props, specialEasing ) {
	var index, name, easing, value, hooks;

	// camelCase, specialEasing and expand cssHook pass
	for ( index in props ) {
		name = camelCase( index );
		easing = specialEasing[ name ];
		value = props[ index ];
		if ( Array.isArray( value ) ) {
			easing = value[ 1 ];
			value = props[ index ] = value[ 0 ];
		}

		if ( index !== name ) {
			props[ name ] = value;
			delete props[ index ];
		}

		hooks = jQuery.cssHooks[ name ];
		if ( hooks && "expand" in hooks ) {
			value = hooks.expand( value );
			delete props[ name ];

			// Not quite $.extend, this won't overwrite existing keys.
			// Reusing 'index' because we have the correct "name"
			for ( index in value ) {
				if ( !( index in props ) ) {
					props[ index ] = value[ index ];
					specialEasing[ index ] = easing;
				}
			}
		} else {
			specialEasing[ name ] = easing;
		}
	}
}

function Animation( elem, properties, options ) {
	var result,
		stopped,
		index = 0,
		length = Animation.prefilters.length,
		deferred = jQuery.Deferred().always( function() {

			// Don't match elem in the :animated selector
			delete tick.elem;
		} ),
		tick = function() {
			if ( stopped ) {
				return false;
			}
			var currentTime = fxNow || createFxNow(),
				remaining = Math.max( 0, animation.startTime + animation.duration - currentTime ),

				// Support: Android 2.3 only
				// Archaic crash bug won't allow us to use `1 - ( 0.5 || 0 )` (#12497)
				temp = remaining / animation.duration || 0,
				percent = 1 - temp,
				index = 0,
				length = animation.tweens.length;

			for ( ; index < length; index++ ) {
				animation.tweens[ index ].run( percent );
			}

			deferred.notifyWith( elem, [ animation, percent, remaining ] );

			// If there's more to do, yield
			if ( percent < 1 && length ) {
				return remaining;
			}

			// If this was an empty animation, synthesize a final progress notification
			if ( !length ) {
				deferred.notifyWith( elem, [ animation, 1, 0 ] );
			}

			// Resolve the animation and report its conclusion
			deferred.resolveWith( elem, [ animation ] );
			return false;
		},
		animation = deferred.promise( {
			elem: elem,
			props: jQuery.extend( {}, properties ),
			opts: jQuery.extend( true, {
				specialEasing: {},
				easing: jQuery.easing._default
			}, options ),
			originalProperties: properties,
			originalOptions: options,
			startTime: fxNow || createFxNow(),
			duration: options.duration,
			tweens: [],
			createTween: function( prop, end ) {
				var tween = jQuery.Tween( elem, animation.opts, prop, end,
						animation.opts.specialEasing[ prop ] || animation.opts.easing );
				animation.tweens.push( tween );
				return tween;
			},
			stop: function( gotoEnd ) {
				var index = 0,

					// If we are going to the end, we want to run all the tweens
					// otherwise we skip this part
					length = gotoEnd ? animation.tweens.length : 0;
				if ( stopped ) {
					return this;
				}
				stopped = true;
				for ( ; index < length; index++ ) {
					animation.tweens[ index ].run( 1 );
				}

				// Resolve when we played the last frame; otherwise, reject
				if ( gotoEnd ) {
					deferred.notifyWith( elem, [ animation, 1, 0 ] );
					deferred.resolveWith( elem, [ animation, gotoEnd ] );
				} else {
					deferred.rejectWith( elem, [ animation, gotoEnd ] );
				}
				return this;
			}
		} ),
		props = animation.props;

	propFilter( props, animation.opts.specialEasing );

	for ( ; index < length; index++ ) {
		result = Animation.prefilters[ index ].call( animation, elem, props, animation.opts );
		if ( result ) {
			if ( isFunction( result.stop ) ) {
				jQuery._queueHooks( animation.elem, animation.opts.queue ).stop =
					result.stop.bind( result );
			}
			return result;
		}
	}

	jQuery.map( props, createTween, animation );

	if ( isFunction( animation.opts.start ) ) {
		animation.opts.start.call( elem, animation );
	}

	// Attach callbacks from options
	animation
		.progress( animation.opts.progress )
		.done( animation.opts.done, animation.opts.complete )
		.fail( animation.opts.fail )
		.always( animation.opts.always );

	jQuery.fx.timer(
		jQuery.extend( tick, {
			elem: elem,
			anim: animation,
			queue: animation.opts.queue
		} )
	);

	return animation;
}

jQuery.Animation = jQuery.extend( Animation, {

	tweeners: {
		"*": [ function( prop, value ) {
			var tween = this.createTween( prop, value );
			adjustCSS( tween.elem, prop, rcssNum.exec( value ), tween );
			return tween;
		} ]
	},

	tweener: function( props, callback ) {
		if ( isFunction( props ) ) {
			callback = props;
			props = [ "*" ];
		} else {
			props = props.match( rnothtmlwhite );
		}

		var prop,
			index = 0,
			length = props.length;

		for ( ; index < length; index++ ) {
			prop = props[ index ];
			Animation.tweeners[ prop ] = Animation.tweeners[ prop ] || [];
			Animation.tweeners[ prop ].unshift( callback );
		}
	},

	prefilters: [ defaultPrefilter ],

	prefilter: function( callback, prepend ) {
		if ( prepend ) {
			Animation.prefilters.unshift( callback );
		} else {
			Animation.prefilters.push( callback );
		}
	}
} );

jQuery.speed = function( speed, easing, fn ) {
	var opt = speed && typeof speed === "object" ? jQuery.extend( {}, speed ) : {
		complete: fn || !fn && easing ||
			isFunction( speed ) && speed,
		duration: speed,
		easing: fn && easing || easing && !isFunction( easing ) && easing
	};

	// Go to the end state if fx are off
	if ( jQuery.fx.off ) {
		opt.duration = 0;

	} else {
		if ( typeof opt.duration !== "number" ) {
			if ( opt.duration in jQuery.fx.speeds ) {
				opt.duration = jQuery.fx.speeds[ opt.duration ];

			} else {
				opt.duration = jQuery.fx.speeds._default;
			}
		}
	}

	// Normalize opt.queue - true/undefined/null -> "fx"
	if ( opt.queue == null || opt.queue === true ) {
		opt.queue = "fx";
	}

	// Queueing
	opt.old = opt.complete;

	opt.complete = function() {
		if ( isFunction( opt.old ) ) {
			opt.old.call( this );
		}

		if ( opt.queue ) {
			jQuery.dequeue( this, opt.queue );
		}
	};

	return opt;
};

jQuery.fn.extend( {
	fadeTo: function( speed, to, easing, callback ) {

		// Show any hidden elements after setting opacity to 0
		return this.filter( isHiddenWithinTree ).css( "opacity", 0 ).show()

			// Animate to the value specified
			.end().animate( { opacity: to }, speed, easing, callback );
	},
	animate: function( prop, speed, easing, callback ) {
		var empty = jQuery.isEmptyObject( prop ),
			optall = jQuery.speed( speed, easing, callback ),
			doAnimation = function() {

				// Operate on a copy of prop so per-property easing won't be lost
				var anim = Animation( this, jQuery.extend( {}, prop ), optall );

				// Empty animations, or finishing resolves immediately
				if ( empty || dataPriv.get( this, "finish" ) ) {
					anim.stop( true );
				}
			};
			doAnimation.finish = doAnimation;

		return empty || optall.queue === false ?
			this.each( doAnimation ) :
			this.queue( optall.queue, doAnimation );
	},
	stop: function( type, clearQueue, gotoEnd ) {
		var stopQueue = function( hooks ) {
			var stop = hooks.stop;
			delete hooks.stop;
			stop( gotoEnd );
		};

		if ( typeof type !== "string" ) {
			gotoEnd = clearQueue;
			clearQueue = type;
			type = undefined;
		}
		if ( clearQueue ) {
			this.queue( type || "fx", [] );
		}

		return this.each( function() {
			var dequeue = true,
				index = type != null && type + "queueHooks",
				timers = jQuery.timers,
				data = dataPriv.get( this );

			if ( index ) {
				if ( data[ index ] && data[ index ].stop ) {
					stopQueue( data[ index ] );
				}
			} else {
				for ( index in data ) {
					if ( data[ index ] && data[ index ].stop && rrun.test( index ) ) {
						stopQueue( data[ index ] );
					}
				}
			}

			for ( index = timers.length; index--; ) {
				if ( timers[ index ].elem === this &&
					( type == null || timers[ index ].queue === type ) ) {

					timers[ index ].anim.stop( gotoEnd );
					dequeue = false;
					timers.splice( index, 1 );
				}
			}

			// Start the next in the queue if the last step wasn't forced.
			// Timers currently will call their complete callbacks, which
			// will dequeue but only if they were gotoEnd.
			if ( dequeue || !gotoEnd ) {
				jQuery.dequeue( this, type );
			}
		} );
	},
	finish: function( type ) {
		if ( type !== false ) {
			type = type || "fx";
		}
		return this.each( function() {
			var index,
				data = dataPriv.get( this ),
				queue = data[ type + "queue" ],
				hooks = data[ type + "queueHooks" ],
				timers = jQuery.timers,
				length = queue ? queue.length : 0;

			// Enable finishing flag on private data
			data.finish = true;

			// Empty the queue first
			jQuery.queue( this, type, [] );

			if ( hooks && hooks.stop ) {
				hooks.stop.call( this, true );
			}

			// Look for any active animations, and finish them
			for ( index = timers.length; index--; ) {
				if ( timers[ index ].elem === this && timers[ index ].queue === type ) {
					timers[ index ].anim.stop( true );
					timers.splice( index, 1 );
				}
			}

			// Look for any animations in the old queue and finish them
			for ( index = 0; index < length; index++ ) {
				if ( queue[ index ] && queue[ index ].finish ) {
					queue[ index ].finish.call( this );
				}
			}

			// Turn off finishing flag
			delete data.finish;
		} );
	}
} );

jQuery.each( [ "toggle", "show", "hide" ], function( _i, name ) {
	var cssFn = jQuery.fn[ name ];
	jQuery.fn[ name ] = function( speed, easing, callback ) {
		return speed == null || typeof speed === "boolean" ?
			cssFn.apply( this, arguments ) :
			this.animate( genFx( name, true ), speed, easing, callback );
	};
} );

// Generate shortcuts for custom animations
jQuery.each( {
	slideDown: genFx( "show" ),
	slideUp: genFx( "hide" ),
	slideToggle: genFx( "toggle" ),
	fadeIn: { opacity: "show" },
	fadeOut: { opacity: "hide" },
	fadeToggle: { opacity: "toggle" }
}, function( name, props ) {
	jQuery.fn[ name ] = function( speed, easing, callback ) {
		return this.animate( props, speed, easing, callback );
	};
} );

jQuery.timers = [];
jQuery.fx.tick = function() {
	var timer,
		i = 0,
		timers = jQuery.timers;

	fxNow = Date.now();

	for ( ; i < timers.length; i++ ) {
		timer = timers[ i ];

		// Run the timer and safely remove it when done (allowing for external removal)
		if ( !timer() && timers[ i ] === timer ) {
			timers.splice( i--, 1 );
		}
	}

	if ( !timers.length ) {
		jQuery.fx.stop();
	}
	fxNow = undefined;
};

jQuery.fx.timer = function( timer ) {
	jQuery.timers.push( timer );
	jQuery.fx.start();
};

jQuery.fx.interval = 13;
jQuery.fx.start = function() {
	if ( inProgress ) {
		return;
	}

	inProgress = true;
	schedule();
};

jQuery.fx.stop = function() {
	inProgress = null;
};

jQuery.fx.speeds = {
	slow: 600,
	fast: 200,

	// Default speed
	_default: 400
};


// Based off of the plugin by Clint Helfers, with permission.
// https://web.archive.org/web/20100324014747/http://blindsignals.com/index.php/2009/07/jquery-delay/
jQuery.fn.delay = function( time, type ) {
	time = jQuery.fx ? jQuery.fx.speeds[ time ] || time : time;
	type = type || "fx";

	return this.queue( type, function( next, hooks ) {
		var timeout = window.setTimeout( next, time );
		hooks.stop = function() {
			window.clearTimeout( timeout );
		};
	} );
};


( function() {
	var input = document.createElement( "input" ),
		select = document.createElement( "select" ),
		opt = select.appendChild( document.createElement( "option" ) );

	input.type = "checkbox";

	// Support: Android <=4.3 only
	// Default value for a checkbox should be "on"
	support.checkOn = input.value !== "";

	// Support: IE <=11 only
	// Must access selectedIndex to make default options select
	support.optSelected = opt.selected;

	// Support: IE <=11 only
	// An input loses its value after becoming a radio
	input = document.createElement( "input" );
	input.value = "t";
	input.type = "radio";
	support.radioValue = input.value === "t";
} )();


var boolHook,
	attrHandle = jQuery.expr.attrHandle;

jQuery.fn.extend( {
	attr: function( name, value ) {
		return access( this, jQuery.attr, name, value, arguments.length > 1 );
	},

	removeAttr: function( name ) {
		return this.each( function() {
			jQuery.removeAttr( this, name );
		} );
	}
} );

jQuery.extend( {
	attr: function( elem, name, value ) {
		var ret, hooks,
			nType = elem.nodeType;

		// Don't get/set attributes on text, comment and attribute nodes
		if ( nType === 3 || nType === 8 || nType === 2 ) {
			return;
		}

		// Fallback to prop when attributes are not supported
		if ( typeof elem.getAttribute === "undefined" ) {
			return jQuery.prop( elem, name, value );
		}

		// Attribute hooks are determined by the lowercase version
		// Grab necessary hook if one is defined
		if ( nType !== 1 || !jQuery.isXMLDoc( elem ) ) {
			hooks = jQuery.attrHooks[ name.toLowerCase() ] ||
				( jQuery.expr.match.bool.test( name ) ? boolHook : undefined );
		}

		if ( value !== undefined ) {
			if ( value === null ) {
				jQuery.removeAttr( elem, name );
				return;
			}

			if ( hooks && "set" in hooks &&
				( ret = hooks.set( elem, value, name ) ) !== undefined ) {
				return ret;
			}

			elem.setAttribute( name, value + "" );
			return value;
		}

		if ( hooks && "get" in hooks && ( ret = hooks.get( elem, name ) ) !== null ) {
			return ret;
		}

		ret = jQuery.find.attr( elem, name );

		// Non-existent attributes return null, we normalize to undefined
		return ret == null ? undefined : ret;
	},

	attrHooks: {
		type: {
			set: function( elem, value ) {
				if ( !support.radioValue && value === "radio" &&
					nodeName( elem, "input" ) ) {
					var val = elem.value;
					elem.setAttribute( "type", value );
					if ( val ) {
						elem.value = val;
					}
					return value;
				}
			}
		}
	},

	removeAttr: function( elem, value ) {
		var name,
			i = 0,

			// Attribute names can contain non-HTML whitespace characters
			// https://html.spec.whatwg.org/multipage/syntax.html#attributes-2
			attrNames = value && value.match( rnothtmlwhite );

		if ( attrNames && elem.nodeType === 1 ) {
			while ( ( name = attrNames[ i++ ] ) ) {
				elem.removeAttribute( name );
			}
		}
	}
} );

// Hooks for boolean attributes
boolHook = {
	set: function( elem, value, name ) {
		if ( value === false ) {

			// Remove boolean attributes when set to false
			jQuery.removeAttr( elem, name );
		} else {
			elem.setAttribute( name, name );
		}
		return name;
	}
};

jQuery.each( jQuery.expr.match.bool.source.match( /\w+/g ), function( _i, name ) {
	var getter = attrHandle[ name ] || jQuery.find.attr;

	attrHandle[ name ] = function( elem, name, isXML ) {
		var ret, handle,
			lowercaseName = name.toLowerCase();

		if ( !isXML ) {

			// Avoid an infinite loop by temporarily removing this function from the getter
			handle = attrHandle[ lowercaseName ];
			attrHandle[ lowercaseName ] = ret;
			ret = getter( elem, name, isXML ) != null ?
				lowercaseName :
				null;
			attrHandle[ lowercaseName ] = handle;
		}
		return ret;
	};
} );




var rfocusable = /^(?:input|select|textarea|button)$/i,
	rclickable = /^(?:a|area)$/i;

jQuery.fn.extend( {
	prop: function( name, value ) {
		return access( this, jQuery.prop, name, value, arguments.length > 1 );
	},

	removeProp: function( name ) {
		return this.each( function() {
			delete this[ jQuery.propFix[ name ] || name ];
		} );
	}
} );

jQuery.extend( {
	prop: function( elem, name, value ) {
		var ret, hooks,
			nType = elem.nodeType;

		// Don't get/set properties on text, comment and attribute nodes
		if ( nType === 3 || nType === 8 || nType === 2 ) {
			return;
		}

		if ( nType !== 1 || !jQuery.isXMLDoc( elem ) ) {

			// Fix name and attach hooks
			name = jQuery.propFix[ name ] || name;
			hooks = jQuery.propHooks[ name ];
		}

		if ( value !== undefined ) {
			if ( hooks && "set" in hooks &&
				( ret = hooks.set( elem, value, name ) ) !== undefined ) {
				return ret;
			}

			return ( elem[ name ] = value );
		}

		if ( hooks && "get" in hooks && ( ret = hooks.get( elem, name ) ) !== null ) {
			return ret;
		}

		return elem[ name ];
	},

	propHooks: {
		tabIndex: {
			get: function( elem ) {

				// Support: IE <=9 - 11 only
				// elem.tabIndex doesn't always return the
				// correct value when it hasn't been explicitly set
				// https://web.archive.org/web/20141116233347/http://fluidproject.org/blog/2008/01/09/getting-setting-and-removing-tabindex-values-with-javascript/
				// Use proper attribute retrieval(#12072)
				var tabindex = jQuery.find.attr( elem, "tabindex" );

				if ( tabindex ) {
					return parseInt( tabindex, 10 );
				}

				if (
					rfocusable.test( elem.nodeName ) ||
					rclickable.test( elem.nodeName ) &&
					elem.href
				) {
					return 0;
				}

				return -1;
			}
		}
	},

	propFix: {
		"for": "htmlFor",
		"class": "className"
	}
} );

// Support: IE <=11 only
// Accessing the selectedIndex property
// forces the browser to respect setting selected
// on the option
// The getter ensures a default option is selected
// when in an optgroup
// eslint rule "no-unused-expressions" is disabled for this code
// since it considers such accessions noop
if ( !support.optSelected ) {
	jQuery.propHooks.selected = {
		get: function( elem ) {

			/* eslint no-unused-expressions: "off" */

			var parent = elem.parentNode;
			if ( parent && parent.parentNode ) {
				parent.parentNode.selectedIndex;
			}
			return null;
		},
		set: function( elem ) {

			/* eslint no-unused-expressions: "off" */

			var parent = elem.parentNode;
			if ( parent ) {
				parent.selectedIndex;

				if ( parent.parentNode ) {
					parent.parentNode.selectedIndex;
				}
			}
		}
	};
}

jQuery.each( [
	"tabIndex",
	"readOnly",
	"maxLength",
	"cellSpacing",
	"cellPadding",
	"rowSpan",
	"colSpan",
	"useMap",
	"frameBorder",
	"contentEditable"
], function() {
	jQuery.propFix[ this.toLowerCase() ] = this;
} );




	// Strip and collapse whitespace according to HTML spec
	// https://infra.spec.whatwg.org/#strip-and-collapse-ascii-whitespace
	function stripAndCollapse( value ) {
		var tokens = value.match( rnothtmlwhite ) || [];
		return tokens.join( " " );
	}


function getClass( elem ) {
	return elem.getAttribute && elem.getAttribute( "class" ) || "";
}

function classesToArray( value ) {
	if ( Array.isArray( value ) ) {
		return value;
	}
	if ( typeof value === "string" ) {
		return value.match( rnothtmlwhite ) || [];
	}
	return [];
}

jQuery.fn.extend( {
	addClass: function( value ) {
		var classes, elem, cur, curValue, clazz, j, finalValue,
			i = 0;

		if ( isFunction( value ) ) {
			return this.each( function( j ) {
				jQuery( this ).addClass( value.call( this, j, getClass( this ) ) );
			} );
		}

		classes = classesToArray( value );

		if ( classes.length ) {
			while ( ( elem = this[ i++ ] ) ) {
				curValue = getClass( elem );
				cur = elem.nodeType === 1 && ( " " + stripAndCollapse( curValue ) + " " );

				if ( cur ) {
					j = 0;
					while ( ( clazz = classes[ j++ ] ) ) {
						if ( cur.indexOf( " " + clazz + " " ) < 0 ) {
							cur += clazz + " ";
						}
					}

					// Only assign if different to avoid unneeded rendering.
					finalValue = stripAndCollapse( cur );
					if ( curValue !== finalValue ) {
						elem.setAttribute( "class", finalValue );
					}
				}
			}
		}

		return this;
	},

	removeClass: function( value ) {
		var classes, elem, cur, curValue, clazz, j, finalValue,
			i = 0;

		if ( isFunction( value ) ) {
			return this.each( function( j ) {
				jQuery( this ).removeClass( value.call( this, j, getClass( this ) ) );
			} );
		}

		if ( !arguments.length ) {
			return this.attr( "class", "" );
		}

		classes = classesToArray( value );

		if ( classes.length ) {
			while ( ( elem = this[ i++ ] ) ) {
				curValue = getClass( elem );

				// This expression is here for better compressibility (see addClass)
				cur = elem.nodeType === 1 && ( " " + stripAndCollapse( curValue ) + " " );

				if ( cur ) {
					j = 0;
					while ( ( clazz = classes[ j++ ] ) ) {

						// Remove *all* instances
						while ( cur.indexOf( " " + clazz + " " ) > -1 ) {
							cur = cur.replace( " " + clazz + " ", " " );
						}
					}

					// Only assign if different to avoid unneeded rendering.
					finalValue = stripAndCollapse( cur );
					if ( curValue !== finalValue ) {
						elem.setAttribute( "class", finalValue );
					}
				}
			}
		}

		return this;
	},

	toggleClass: function( value, stateVal ) {
		var type = typeof value,
			isValidValue = type === "string" || Array.isArray( value );

		if ( typeof stateVal === "boolean" && isValidValue ) {
			return stateVal ? this.addClass( value ) : this.removeClass( value );
		}

		if ( isFunction( value ) ) {
			return this.each( function( i ) {
				jQuery( this ).toggleClass(
					value.call( this, i, getClass( this ), stateVal ),
					stateVal
				);
			} );
		}

		return this.each( function() {
			var className, i, self, classNames;

			if ( isValidValue ) {

				// Toggle individual class names
				i = 0;
				self = jQuery( this );
				classNames = classesToArray( value );

				while ( ( className = classNames[ i++ ] ) ) {

					// Check each className given, space separated list
					if ( self.hasClass( className ) ) {
						self.removeClass( className );
					} else {
						self.addClass( className );
					}
				}

			// Toggle whole class name
			} else if ( value === undefined || type === "boolean" ) {
				className = getClass( this );
				if ( className ) {

					// Store className if set
					dataPriv.set( this, "__className__", className );
				}

				// If the element has a class name or if we're passed `false`,
				// then remove the whole classname (if there was one, the above saved it).
				// Otherwise bring back whatever was previously saved (if anything),
				// falling back to the empty string if nothing was stored.
				if ( this.setAttribute ) {
					this.setAttribute( "class",
						className || value === false ?
						"" :
						dataPriv.get( this, "__className__" ) || ""
					);
				}
			}
		} );
	},

	hasClass: function( selector ) {
		var className, elem,
			i = 0;

		className = " " + selector + " ";
		while ( ( elem = this[ i++ ] ) ) {
			if ( elem.nodeType === 1 &&
				( " " + stripAndCollapse( getClass( elem ) ) + " " ).indexOf( className ) > -1 ) {
					return true;
			}
		}

		return false;
	}
} );




var rreturn = /\r/g;

jQuery.fn.extend( {
	val: function( value ) {
		var hooks, ret, valueIsFunction,
			elem = this[ 0 ];

		if ( !arguments.length ) {
			if ( elem ) {
				hooks = jQuery.valHooks[ elem.type ] ||
					jQuery.valHooks[ elem.nodeName.toLowerCase() ];

				if ( hooks &&
					"get" in hooks &&
					( ret = hooks.get( elem, "value" ) ) !== undefined
				) {
					return ret;
				}

				ret = elem.value;

				// Handle most common string cases
				if ( typeof ret === "string" ) {
					return ret.replace( rreturn, "" );
				}

				// Handle cases where value is null/undef or number
				return ret == null ? "" : ret;
			}

			return;
		}

		valueIsFunction = isFunction( value );

		return this.each( function( i ) {
			var val;

			if ( this.nodeType !== 1 ) {
				return;
			}

			if ( valueIsFunction ) {
				val = value.call( this, i, jQuery( this ).val() );
			} else {
				val = value;
			}

			// Treat null/undefined as ""; convert numbers to string
			if ( val == null ) {
				val = "";

			} else if ( typeof val === "number" ) {
				val += "";

			} else if ( Array.isArray( val ) ) {
				val = jQuery.map( val, function( value ) {
					return value == null ? "" : value + "";
				} );
			}

			hooks = jQuery.valHooks[ this.type ] || jQuery.valHooks[ this.nodeName.toLowerCase() ];

			// If set returns undefined, fall back to normal setting
			if ( !hooks || !( "set" in hooks ) || hooks.set( this, val, "value" ) === undefined ) {
				this.value = val;
			}
		} );
	}
} );

jQuery.extend( {
	valHooks: {
		option: {
			get: function( elem ) {

				var val = jQuery.find.attr( elem, "value" );
				return val != null ?
					val :

					// Support: IE <=10 - 11 only
					// option.text throws exceptions (#14686, #14858)
					// Strip and collapse whitespace
					// https://html.spec.whatwg.org/#strip-and-collapse-whitespace
					stripAndCollapse( jQuery.text( elem ) );
			}
		},
		select: {
			get: function( elem ) {
				var value, option, i,
					options = elem.options,
					index = elem.selectedIndex,
					one = elem.type === "select-one",
					values = one ? null : [],
					max = one ? index + 1 : options.length;

				if ( index < 0 ) {
					i = max;

				} else {
					i = one ? index : 0;
				}

				// Loop through all the selected options
				for ( ; i < max; i++ ) {
					option = options[ i ];

					// Support: IE <=9 only
					// IE8-9 doesn't update selected after form reset (#2551)
					if ( ( option.selected || i === index ) &&

							// Don't return options that are disabled or in a disabled optgroup
							!option.disabled &&
							( !option.parentNode.disabled ||
								!nodeName( option.parentNode, "optgroup" ) ) ) {

						// Get the specific value for the option
						value = jQuery( option ).val();

						// We don't need an array for one selects
						if ( one ) {
							return value;
						}

						// Multi-Selects return an array
						values.push( value );
					}
				}

				return values;
			},

			set: function( elem, value ) {
				var optionSet, option,
					options = elem.options,
					values = jQuery.makeArray( value ),
					i = options.length;

				while ( i-- ) {
					option = options[ i ];

					/* eslint-disable no-cond-assign */

					if ( option.selected =
						jQuery.inArray( jQuery.valHooks.option.get( option ), values ) > -1
					) {
						optionSet = true;
					}

					/* eslint-enable no-cond-assign */
				}

				// Force browsers to behave consistently when non-matching value is set
				if ( !optionSet ) {
					elem.selectedIndex = -1;
				}
				return values;
			}
		}
	}
} );

// Radios and checkboxes getter/setter
jQuery.each( [ "radio", "checkbox" ], function() {
	jQuery.valHooks[ this ] = {
		set: function( elem, value ) {
			if ( Array.isArray( value ) ) {
				return ( elem.checked = jQuery.inArray( jQuery( elem ).val(), value ) > -1 );
			}
		}
	};
	if ( !support.checkOn ) {
		jQuery.valHooks[ this ].get = function( elem ) {
			return elem.getAttribute( "value" ) === null ? "on" : elem.value;
		};
	}
} );




// Return jQuery for attributes-only inclusion


support.focusin = "onfocusin" in window;


var rfocusMorph = /^(?:focusinfocus|focusoutblur)$/,
	stopPropagationCallback = function( e ) {
		e.stopPropagation();
	};

jQuery.extend( jQuery.event, {

	trigger: function( event, data, elem, onlyHandlers ) {

		var i, cur, tmp, bubbleType, ontype, handle, special, lastElement,
			eventPath = [ elem || document ],
			type = hasOwn.call( event, "type" ) ? event.type : event,
			namespaces = hasOwn.call( event, "namespace" ) ? event.namespace.split( "." ) : [];

		cur = lastElement = tmp = elem = elem || document;

		// Don't do events on text and comment nodes
		if ( elem.nodeType === 3 || elem.nodeType === 8 ) {
			return;
		}

		// focus/blur morphs to focusin/out; ensure we're not firing them right now
		if ( rfocusMorph.test( type + jQuery.event.triggered ) ) {
			return;
		}

		if ( type.indexOf( "." ) > -1 ) {

			// Namespaced trigger; create a regexp to match event type in handle()
			namespaces = type.split( "." );
			type = namespaces.shift();
			namespaces.sort();
		}
		ontype = type.indexOf( ":" ) < 0 && "on" + type;

		// Caller can pass in a jQuery.Event object, Object, or just an event type string
		event = event[ jQuery.expando ] ?
			event :
			new jQuery.Event( type, typeof event === "object" && event );

		// Trigger bitmask: & 1 for native handlers; & 2 for jQuery (always true)
		event.isTrigger = onlyHandlers ? 2 : 3;
		event.namespace = namespaces.join( "." );
		event.rnamespace = event.namespace ?
			new RegExp( "(^|\\.)" + namespaces.join( "\\.(?:.*\\.|)" ) + "(\\.|$)" ) :
			null;

		// Clean up the event in case it is being reused
		event.result = undefined;
		if ( !event.target ) {
			event.target = elem;
		}

		// Clone any incoming data and prepend the event, creating the handler arg list
		data = data == null ?
			[ event ] :
			jQuery.makeArray( data, [ event ] );

		// Allow special events to draw outside the lines
		special = jQuery.event.special[ type ] || {};
		if ( !onlyHandlers && special.trigger && special.trigger.apply( elem, data ) === false ) {
			return;
		}

		// Determine event propagation path in advance, per W3C events spec (#9951)
		// Bubble up to document, then to window; watch for a global ownerDocument var (#9724)
		if ( !onlyHandlers && !special.noBubble && !isWindow( elem ) ) {

			bubbleType = special.delegateType || type;
			if ( !rfocusMorph.test( bubbleType + type ) ) {
				cur = cur.parentNode;
			}
			for ( ; cur; cur = cur.parentNode ) {
				eventPath.push( cur );
				tmp = cur;
			}

			// Only add window if we got to document (e.g., not plain obj or detached DOM)
			if ( tmp === ( elem.ownerDocument || document ) ) {
				eventPath.push( tmp.defaultView || tmp.parentWindow || window );
			}
		}

		// Fire handlers on the event path
		i = 0;
		while ( ( cur = eventPath[ i++ ] ) && !event.isPropagationStopped() ) {
			lastElement = cur;
			event.type = i > 1 ?
				bubbleType :
				special.bindType || type;

			// jQuery handler
			handle = (
					dataPriv.get( cur, "events" ) || Object.create( null )
				)[ event.type ] &&
				dataPriv.get( cur, "handle" );
			if ( handle ) {
				handle.apply( cur, data );
			}

			// Native handler
			handle = ontype && cur[ ontype ];
			if ( handle && handle.apply && acceptData( cur ) ) {
				event.result = handle.apply( cur, data );
				if ( event.result === false ) {
					event.preventDefault();
				}
			}
		}
		event.type = type;

		// If nobody prevented the default action, do it now
		if ( !onlyHandlers && !event.isDefaultPrevented() ) {

			if ( ( !special._default ||
				special._default.apply( eventPath.pop(), data ) === false ) &&
				acceptData( elem ) ) {

				// Call a native DOM method on the target with the same name as the event.
				// Don't do default actions on window, that's where global variables be (#6170)
				if ( ontype && isFunction( elem[ type ] ) && !isWindow( elem ) ) {

					// Don't re-trigger an onFOO event when we call its FOO() method
					tmp = elem[ ontype ];

					if ( tmp ) {
						elem[ ontype ] = null;
					}

					// Prevent re-triggering of the same event, since we already bubbled it above
					jQuery.event.triggered = type;

					if ( event.isPropagationStopped() ) {
						lastElement.addEventListener( type, stopPropagationCallback );
					}

					elem[ type ]();

					if ( event.isPropagationStopped() ) {
						lastElement.removeEventListener( type, stopPropagationCallback );
					}

					jQuery.event.triggered = undefined;

					if ( tmp ) {
						elem[ ontype ] = tmp;
					}
				}
			}
		}

		return event.result;
	},

	// Piggyback on a donor event to simulate a different one
	// Used only for `focus(in | out)` events
	simulate: function( type, elem, event ) {
		var e = jQuery.extend(
			new jQuery.Event(),
			event,
			{
				type: type,
				isSimulated: true
			}
		);

		jQuery.event.trigger( e, null, elem );
	}

} );

jQuery.fn.extend( {

	trigger: function( type, data ) {
		return this.each( function() {
			jQuery.event.trigger( type, data, this );
		} );
	},
	triggerHandler: function( type, data ) {
		var elem = this[ 0 ];
		if ( elem ) {
			return jQuery.event.trigger( type, data, elem, true );
		}
	}
} );


// Support: Firefox <=44
// Firefox doesn't have focus(in | out) events
// Related ticket - https://bugzilla.mozilla.org/show_bug.cgi?id=687787
//
// Support: Chrome <=48 - 49, Safari <=9.0 - 9.1
// focus(in | out) events fire after focus & blur events,
// which is spec violation - http://www.w3.org/TR/DOM-Level-3-Events/#events-focusevent-event-order
// Related ticket - https://bugs.chromium.org/p/chromium/issues/detail?id=449857
if ( !support.focusin ) {
	jQuery.each( { focus: "focusin", blur: "focusout" }, function( orig, fix ) {

		// Attach a single capturing handler on the document while someone wants focusin/focusout
		var handler = function( event ) {
			jQuery.event.simulate( fix, event.target, jQuery.event.fix( event ) );
		};

		jQuery.event.special[ fix ] = {
			setup: function() {

				// Handle: regular nodes (via `this.ownerDocument`), window
				// (via `this.document`) & document (via `this`).
				var doc = this.ownerDocument || this.document || this,
					attaches = dataPriv.access( doc, fix );

				if ( !attaches ) {
					doc.addEventListener( orig, handler, true );
				}
				dataPriv.access( doc, fix, ( attaches || 0 ) + 1 );
			},
			teardown: function() {
				var doc = this.ownerDocument || this.document || this,
					attaches = dataPriv.access( doc, fix ) - 1;

				if ( !attaches ) {
					doc.removeEventListener( orig, handler, true );
					dataPriv.remove( doc, fix );

				} else {
					dataPriv.access( doc, fix, attaches );
				}
			}
		};
	} );
}
var location = window.location;

var nonce = { guid: Date.now() };

var rquery = ( /\?/ );



// Cross-browser xml parsing
jQuery.parseXML = function( data ) {
	var xml;
	if ( !data || typeof data !== "string" ) {
		return null;
	}

	// Support: IE 9 - 11 only
	// IE throws on parseFromString with invalid input.
	try {
		xml = ( new window.DOMParser() ).parseFromString( data, "text/xml" );
	} catch ( e ) {
		xml = undefined;
	}

	if ( !xml || xml.getElementsByTagName( "parsererror" ).length ) {
		jQuery.error( "Invalid XML: " + data );
	}
	return xml;
};


var
	rbracket = /\[\]$/,
	rCRLF = /\r?\n/g,
	rsubmitterTypes = /^(?:submit|button|image|reset|file)$/i,
	rsubmittable = /^(?:input|select|textarea|keygen)/i;

function buildParams( prefix, obj, traditional, add ) {
	var name;

	if ( Array.isArray( obj ) ) {

		// Serialize array item.
		jQuery.each( obj, function( i, v ) {
			if ( traditional || rbracket.test( prefix ) ) {

				// Treat each array item as a scalar.
				add( prefix, v );

			} else {

				// Item is non-scalar (array or object), encode its numeric index.
				buildParams(
					prefix + "[" + ( typeof v === "object" && v != null ? i : "" ) + "]",
					v,
					traditional,
					add
				);
			}
		} );

	} else if ( !traditional && toType( obj ) === "object" ) {

		// Serialize object item.
		for ( name in obj ) {
			buildParams( prefix + "[" + name + "]", obj[ name ], traditional, add );
		}

	} else {

		// Serialize scalar item.
		add( prefix, obj );
	}
}

// Serialize an array of form elements or a set of
// key/values into a query string
jQuery.param = function( a, traditional ) {
	var prefix,
		s = [],
		add = function( key, valueOrFunction ) {

			// If value is a function, invoke it and use its return value
			var value = isFunction( valueOrFunction ) ?
				valueOrFunction() :
				valueOrFunction;

			s[ s.length ] = encodeURIComponent( key ) + "=" +
				encodeURIComponent( value == null ? "" : value );
		};

	if ( a == null ) {
		return "";
	}

	// If an array was passed in, assume that it is an array of form elements.
	if ( Array.isArray( a ) || ( a.jquery && !jQuery.isPlainObject( a ) ) ) {

		// Serialize the form elements
		jQuery.each( a, function() {
			add( this.name, this.value );
		} );

	} else {

		// If traditional, encode the "old" way (the way 1.3.2 or older
		// did it), otherwise encode params recursively.
		for ( prefix in a ) {
			buildParams( prefix, a[ prefix ], traditional, add );
		}
	}

	// Return the resulting serialization
	return s.join( "&" );
};

jQuery.fn.extend( {
	serialize: function() {
		return jQuery.param( this.serializeArray() );
	},
	serializeArray: function() {
		return this.map( function() {

			// Can add propHook for "elements" to filter or add form elements
			var elements = jQuery.prop( this, "elements" );
			return elements ? jQuery.makeArray( elements ) : this;
		} )
		.filter( function() {
			var type = this.type;

			// Use .is( ":disabled" ) so that fieldset[disabled] works
			return this.name && !jQuery( this ).is( ":disabled" ) &&
				rsubmittable.test( this.nodeName ) && !rsubmitterTypes.test( type ) &&
				( this.checked || !rcheckableType.test( type ) );
		} )
		.map( function( _i, elem ) {
			var val = jQuery( this ).val();

			if ( val == null ) {
				return null;
			}

			if ( Array.isArray( val ) ) {
				return jQuery.map( val, function( val ) {
					return { name: elem.name, value: val.replace( rCRLF, "\r\n" ) };
				} );
			}

			return { name: elem.name, value: val.replace( rCRLF, "\r\n" ) };
		} ).get();
	}
} );


var
	r20 = /%20/g,
	rhash = /#.*$/,
	rantiCache = /([?&])_=[^&]*/,
	rheaders = /^(.*?):[ \t]*([^\r\n]*)$/mg,

	// #7653, #8125, #8152: local protocol detection
	rlocalProtocol = /^(?:about|app|app-storage|.+-extension|file|res|widget):$/,
	rnoContent = /^(?:GET|HEAD)$/,
	rprotocol = /^\/\//,

	/* Prefilters
	 * 1) They are useful to introduce custom dataTypes (see ajax/jsonp.js for an example)
	 * 2) These are called:
	 *    - BEFORE asking for a transport
	 *    - AFTER param serialization (s.data is a string if s.processData is true)
	 * 3) key is the dataType
	 * 4) the catchall symbol "*" can be used
	 * 5) execution will start with transport dataType and THEN continue down to "*" if needed
	 */
	prefilters = {},

	/* Transports bindings
	 * 1) key is the dataType
	 * 2) the catchall symbol "*" can be used
	 * 3) selection will start with transport dataType and THEN go to "*" if needed
	 */
	transports = {},

	// Avoid comment-prolog char sequence (#10098); must appease lint and evade compression
	allTypes = "*/".concat( "*" ),

	// Anchor tag for parsing the document origin
	originAnchor = document.createElement( "a" );
	originAnchor.href = location.href;

// Base "constructor" for jQuery.ajaxPrefilter and jQuery.ajaxTransport
function addToPrefiltersOrTransports( structure ) {

	// dataTypeExpression is optional and defaults to "*"
	return function( dataTypeExpression, func ) {

		if ( typeof dataTypeExpression !== "string" ) {
			func = dataTypeExpression;
			dataTypeExpression = "*";
		}

		var dataType,
			i = 0,
			dataTypes = dataTypeExpression.toLowerCase().match( rnothtmlwhite ) || [];

		if ( isFunction( func ) ) {

			// For each dataType in the dataTypeExpression
			while ( ( dataType = dataTypes[ i++ ] ) ) {

				// Prepend if requested
				if ( dataType[ 0 ] === "+" ) {
					dataType = dataType.slice( 1 ) || "*";
					( structure[ dataType ] = structure[ dataType ] || [] ).unshift( func );

				// Otherwise append
				} else {
					( structure[ dataType ] = structure[ dataType ] || [] ).push( func );
				}
			}
		}
	};
}

// Base inspection function for prefilters and transports
function inspectPrefiltersOrTransports( structure, options, originalOptions, jqXHR ) {

	var inspected = {},
		seekingTransport = ( structure === transports );

	function inspect( dataType ) {
		var selected;
		inspected[ dataType ] = true;
		jQuery.each( structure[ dataType ] || [], function( _, prefilterOrFactory ) {
			var dataTypeOrTransport = prefilterOrFactory( options, originalOptions, jqXHR );
			if ( typeof dataTypeOrTransport === "string" &&
				!seekingTransport && !inspected[ dataTypeOrTransport ] ) {

				options.dataTypes.unshift( dataTypeOrTransport );
				inspect( dataTypeOrTransport );
				return false;
			} else if ( seekingTransport ) {
				return !( selected = dataTypeOrTransport );
			}
		} );
		return selected;
	}

	return inspect( options.dataTypes[ 0 ] ) || !inspected[ "*" ] && inspect( "*" );
}

// A special extend for ajax options
// that takes "flat" options (not to be deep extended)
// Fixes #9887
function ajaxExtend( target, src ) {
	var key, deep,
		flatOptions = jQuery.ajaxSettings.flatOptions || {};

	for ( key in src ) {
		if ( src[ key ] !== undefined ) {
			( flatOptions[ key ] ? target : ( deep || ( deep = {} ) ) )[ key ] = src[ key ];
		}
	}
	if ( deep ) {
		jQuery.extend( true, target, deep );
	}

	return target;
}

/* Handles responses to an ajax request:
 * - finds the right dataType (mediates between content-type and expected dataType)
 * - returns the corresponding response
 */
function ajaxHandleResponses( s, jqXHR, responses ) {

	var ct, type, finalDataType, firstDataType,
		contents = s.contents,
		dataTypes = s.dataTypes;

	// Remove auto dataType and get content-type in the process
	while ( dataTypes[ 0 ] === "*" ) {
		dataTypes.shift();
		if ( ct === undefined ) {
			ct = s.mimeType || jqXHR.getResponseHeader( "Content-Type" );
		}
	}

	// Check if we're dealing with a known content-type
	if ( ct ) {
		for ( type in contents ) {
			if ( contents[ type ] && contents[ type ].test( ct ) ) {
				dataTypes.unshift( type );
				break;
			}
		}
	}

	// Check to see if we have a response for the expected dataType
	if ( dataTypes[ 0 ] in responses ) {
		finalDataType = dataTypes[ 0 ];
	} else {

		// Try convertible dataTypes
		for ( type in responses ) {
			if ( !dataTypes[ 0 ] || s.converters[ type + " " + dataTypes[ 0 ] ] ) {
				finalDataType = type;
				break;
			}
			if ( !firstDataType ) {
				firstDataType = type;
			}
		}

		// Or just use first one
		finalDataType = finalDataType || firstDataType;
	}

	// If we found a dataType
	// We add the dataType to the list if needed
	// and return the corresponding response
	if ( finalDataType ) {
		if ( finalDataType !== dataTypes[ 0 ] ) {
			dataTypes.unshift( finalDataType );
		}
		return responses[ finalDataType ];
	}
}

/* Chain conversions given the request and the original response
 * Also sets the responseXXX fields on the jqXHR instance
 */
function ajaxConvert( s, response, jqXHR, isSuccess ) {
	var conv2, current, conv, tmp, prev,
		converters = {},

		// Work with a copy of dataTypes in case we need to modify it for conversion
		dataTypes = s.dataTypes.slice();

	// Create converters map with lowercased keys
	if ( dataTypes[ 1 ] ) {
		for ( conv in s.converters ) {
			converters[ conv.toLowerCase() ] = s.converters[ conv ];
		}
	}

	current = dataTypes.shift();

	// Convert to each sequential dataType
	while ( current ) {

		if ( s.responseFields[ current ] ) {
			jqXHR[ s.responseFields[ current ] ] = response;
		}

		// Apply the dataFilter if provided
		if ( !prev && isSuccess && s.dataFilter ) {
			response = s.dataFilter( response, s.dataType );
		}

		prev = current;
		current = dataTypes.shift();

		if ( current ) {

			// There's only work to do if current dataType is non-auto
			if ( current === "*" ) {

				current = prev;

			// Convert response if prev dataType is non-auto and differs from current
			} else if ( prev !== "*" && prev !== current ) {

				// Seek a direct converter
				conv = converters[ prev + " " + current ] || converters[ "* " + current ];

				// If none found, seek a pair
				if ( !conv ) {
					for ( conv2 in converters ) {

						// If conv2 outputs current
						tmp = conv2.split( " " );
						if ( tmp[ 1 ] === current ) {

							// If prev can be converted to accepted input
							conv = converters[ prev + " " + tmp[ 0 ] ] ||
								converters[ "* " + tmp[ 0 ] ];
							if ( conv ) {

								// Condense equivalence converters
								if ( conv === true ) {
									conv = converters[ conv2 ];

								// Otherwise, insert the intermediate dataType
								} else if ( converters[ conv2 ] !== true ) {
									current = tmp[ 0 ];
									dataTypes.unshift( tmp[ 1 ] );
								}
								break;
							}
						}
					}
				}

				// Apply converter (if not an equivalence)
				if ( conv !== true ) {

					// Unless errors are allowed to bubble, catch and return them
					if ( conv && s.throws ) {
						response = conv( response );
					} else {
						try {
							response = conv( response );
						} catch ( e ) {
							return {
								state: "parsererror",
								error: conv ? e : "No conversion from " + prev + " to " + current
							};
						}
					}
				}
			}
		}
	}

	return { state: "success", data: response };
}

jQuery.extend( {

	// Counter for holding the number of active queries
	active: 0,

	// Last-Modified header cache for next request
	lastModified: {},
	etag: {},

	ajaxSettings: {
		url: location.href,
		type: "GET",
		isLocal: rlocalProtocol.test( location.protocol ),
		global: true,
		processData: true,
		async: true,
		contentType: "application/x-www-form-urlencoded; charset=UTF-8",

		/*
		timeout: 0,
		data: null,
		dataType: null,
		username: null,
		password: null,
		cache: null,
		throws: false,
		traditional: false,
		headers: {},
		*/

		accepts: {
			"*": allTypes,
			text: "text/plain",
			html: "text/html",
			xml: "application/xml, text/xml",
			json: "application/json, text/javascript"
		},

		contents: {
			xml: /\bxml\b/,
			html: /\bhtml/,
			json: /\bjson\b/
		},

		responseFields: {
			xml: "responseXML",
			text: "responseText",
			json: "responseJSON"
		},

		// Data converters
		// Keys separate source (or catchall "*") and destination types with a single space
		converters: {

			// Convert anything to text
			"* text": String,

			// Text to html (true = no transformation)
			"text html": true,

			// Evaluate text as a json expression
			"text json": JSON.parse,

			// Parse text as xml
			"text xml": jQuery.parseXML
		},

		// For options that shouldn't be deep extended:
		// you can add your own custom options here if
		// and when you create one that shouldn't be
		// deep extended (see ajaxExtend)
		flatOptions: {
			url: true,
			context: true
		}
	},

	// Creates a full fledged settings object into target
	// with both ajaxSettings and settings fields.
	// If target is omitted, writes into ajaxSettings.
	ajaxSetup: function( target, settings ) {
		return settings ?

			// Building a settings object
			ajaxExtend( ajaxExtend( target, jQuery.ajaxSettings ), settings ) :

			// Extending ajaxSettings
			ajaxExtend( jQuery.ajaxSettings, target );
	},

	ajaxPrefilter: addToPrefiltersOrTransports( prefilters ),
	ajaxTransport: addToPrefiltersOrTransports( transports ),

	// Main method
	ajax: function( url, options ) {

		// If url is an object, simulate pre-1.5 signature
		if ( typeof url === "object" ) {
			options = url;
			url = undefined;
		}

		// Force options to be an object
		options = options || {};

		var transport,

			// URL without anti-cache param
			cacheURL,

			// Response headers
			responseHeadersString,
			responseHeaders,

			// timeout handle
			timeoutTimer,

			// Url cleanup var
			urlAnchor,

			// Request state (becomes false upon send and true upon completion)
			completed,

			// To know if global events are to be dispatched
			fireGlobals,

			// Loop variable
			i,

			// uncached part of the url
			uncached,

			// Create the final options object
			s = jQuery.ajaxSetup( {}, options ),

			// Callbacks context
			callbackContext = s.context || s,

			// Context for global events is callbackContext if it is a DOM node or jQuery collection
			globalEventContext = s.context &&
				( callbackContext.nodeType || callbackContext.jquery ) ?
					jQuery( callbackContext ) :
					jQuery.event,

			// Deferreds
			deferred = jQuery.Deferred(),
			completeDeferred = jQuery.Callbacks( "once memory" ),

			// Status-dependent callbacks
			statusCode = s.statusCode || {},

			// Headers (they are sent all at once)
			requestHeaders = {},
			requestHeadersNames = {},

			// Default abort message
			strAbort = "canceled",

			// Fake xhr
			jqXHR = {
				readyState: 0,

				// Builds headers hashtable if needed
				getResponseHeader: function( key ) {
					var match;
					if ( completed ) {
						if ( !responseHeaders ) {
							responseHeaders = {};
							while ( ( match = rheaders.exec( responseHeadersString ) ) ) {
								responseHeaders[ match[ 1 ].toLowerCase() + " " ] =
									( responseHeaders[ match[ 1 ].toLowerCase() + " " ] || [] )
										.concat( match[ 2 ] );
							}
						}
						match = responseHeaders[ key.toLowerCase() + " " ];
					}
					return match == null ? null : match.join( ", " );
				},

				// Raw string
				getAllResponseHeaders: function() {
					return completed ? responseHeadersString : null;
				},

				// Caches the header
				setRequestHeader: function( name, value ) {
					if ( completed == null ) {
						name = requestHeadersNames[ name.toLowerCase() ] =
							requestHeadersNames[ name.toLowerCase() ] || name;
						requestHeaders[ name ] = value;
					}
					return this;
				},

				// Overrides response content-type header
				overrideMimeType: function( type ) {
					if ( completed == null ) {
						s.mimeType = type;
					}
					return this;
				},

				// Status-dependent callbacks
				statusCode: function( map ) {
					var code;
					if ( map ) {
						if ( completed ) {

							// Execute the appropriate callbacks
							jqXHR.always( map[ jqXHR.status ] );
						} else {

							// Lazy-add the new callbacks in a way that preserves old ones
							for ( code in map ) {
								statusCode[ code ] = [ statusCode[ code ], map[ code ] ];
							}
						}
					}
					return this;
				},

				// Cancel the request
				abort: function( statusText ) {
					var finalText = statusText || strAbort;
					if ( transport ) {
						transport.abort( finalText );
					}
					done( 0, finalText );
					return this;
				}
			};

		// Attach deferreds
		deferred.promise( jqXHR );

		// Add protocol if not provided (prefilters might expect it)
		// Handle falsy url in the settings object (#10093: consistency with old signature)
		// We also use the url parameter if available
		s.url = ( ( url || s.url || location.href ) + "" )
			.replace( rprotocol, location.protocol + "//" );

		// Alias method option to type as per ticket #12004
		s.type = options.method || options.type || s.method || s.type;

		// Extract dataTypes list
		s.dataTypes = ( s.dataType || "*" ).toLowerCase().match( rnothtmlwhite ) || [ "" ];

		// A cross-domain request is in order when the origin doesn't match the current origin.
		if ( s.crossDomain == null ) {
			urlAnchor = document.createElement( "a" );

			// Support: IE <=8 - 11, Edge 12 - 15
			// IE throws exception on accessing the href property if url is malformed,
			// e.g. http://example.com:80x/
			try {
				urlAnchor.href = s.url;

				// Support: IE <=8 - 11 only
				// Anchor's host property isn't correctly set when s.url is relative
				urlAnchor.href = urlAnchor.href;
				s.crossDomain = originAnchor.protocol + "//" + originAnchor.host !==
					urlAnchor.protocol + "//" + urlAnchor.host;
			} catch ( e ) {

				// If there is an error parsing the URL, assume it is crossDomain,
				// it can be rejected by the transport if it is invalid
				s.crossDomain = true;
			}
		}

		// Convert data if not already a string
		if ( s.data && s.processData && typeof s.data !== "string" ) {
			s.data = jQuery.param( s.data, s.traditional );
		}

		// Apply prefilters
		inspectPrefiltersOrTransports( prefilters, s, options, jqXHR );

		// If request was aborted inside a prefilter, stop there
		if ( completed ) {
			return jqXHR;
		}

		// We can fire global events as of now if asked to
		// Don't fire events if jQuery.event is undefined in an AMD-usage scenario (#15118)
		fireGlobals = jQuery.event && s.global;

		// Watch for a new set of requests
		if ( fireGlobals && jQuery.active++ === 0 ) {
			jQuery.event.trigger( "ajaxStart" );
		}

		// Uppercase the type
		s.type = s.type.toUpperCase();

		// Determine if request has content
		s.hasContent = !rnoContent.test( s.type );

		// Save the URL in case we're toying with the If-Modified-Since
		// and/or If-None-Match header later on
		// Remove hash to simplify url manipulation
		cacheURL = s.url.replace( rhash, "" );

		// More options handling for requests with no content
		if ( !s.hasContent ) {

			// Remember the hash so we can put it back
			uncached = s.url.slice( cacheURL.length );

			// If data is available and should be processed, append data to url
			if ( s.data && ( s.processData || typeof s.data === "string" ) ) {
				cacheURL += ( rquery.test( cacheURL ) ? "&" : "?" ) + s.data;

				// #9682: remove data so that it's not used in an eventual retry
				delete s.data;
			}

			// Add or update anti-cache param if needed
			if ( s.cache === false ) {
				cacheURL = cacheURL.replace( rantiCache, "$1" );
				uncached = ( rquery.test( cacheURL ) ? "&" : "?" ) + "_=" + ( nonce.guid++ ) +
					uncached;
			}

			// Put hash and anti-cache on the URL that will be requested (gh-1732)
			s.url = cacheURL + uncached;

		// Change '%20' to '+' if this is encoded form body content (gh-2658)
		} else if ( s.data && s.processData &&
			( s.contentType || "" ).indexOf( "application/x-www-form-urlencoded" ) === 0 ) {
			s.data = s.data.replace( r20, "+" );
		}

		// Set the If-Modified-Since and/or If-None-Match header, if in ifModified mode.
		if ( s.ifModified ) {
			if ( jQuery.lastModified[ cacheURL ] ) {
				jqXHR.setRequestHeader( "If-Modified-Since", jQuery.lastModified[ cacheURL ] );
			}
			if ( jQuery.etag[ cacheURL ] ) {
				jqXHR.setRequestHeader( "If-None-Match", jQuery.etag[ cacheURL ] );
			}
		}

		// Set the correct header, if data is being sent
		if ( s.data && s.hasContent && s.contentType !== false || options.contentType ) {
			jqXHR.setRequestHeader( "Content-Type", s.contentType );
		}

		// Set the Accepts header for the server, depending on the dataType
		jqXHR.setRequestHeader(
			"Accept",
			s.dataTypes[ 0 ] && s.accepts[ s.dataTypes[ 0 ] ] ?
				s.accepts[ s.dataTypes[ 0 ] ] +
					( s.dataTypes[ 0 ] !== "*" ? ", " + allTypes + "; q=0.01" : "" ) :
				s.accepts[ "*" ]
		);

		// Check for headers option
		for ( i in s.headers ) {
			jqXHR.setRequestHeader( i, s.headers[ i ] );
		}

		// Allow custom headers/mimetypes and early abort
		if ( s.beforeSend &&
			( s.beforeSend.call( callbackContext, jqXHR, s ) === false || completed ) ) {

			// Abort if not done already and return
			return jqXHR.abort();
		}

		// Aborting is no longer a cancellation
		strAbort = "abort";

		// Install callbacks on deferreds
		completeDeferred.add( s.complete );
		jqXHR.done( s.success );
		jqXHR.fail( s.error );

		// Get transport
		transport = inspectPrefiltersOrTransports( transports, s, options, jqXHR );

		// If no transport, we auto-abort
		if ( !transport ) {
			done( -1, "No Transport" );
		} else {
			jqXHR.readyState = 1;

			// Send global event
			if ( fireGlobals ) {
				globalEventContext.trigger( "ajaxSend", [ jqXHR, s ] );
			}

			// If request was aborted inside ajaxSend, stop there
			if ( completed ) {
				return jqXHR;
			}

			// Timeout
			if ( s.async && s.timeout > 0 ) {
				timeoutTimer = window.setTimeout( function() {
					jqXHR.abort( "timeout" );
				}, s.timeout );
			}

			try {
				completed = false;
				transport.send( requestHeaders, done );
			} catch ( e ) {

				// Rethrow post-completion exceptions
				if ( completed ) {
					throw e;
				}

				// Propagate others as results
				done( -1, e );
			}
		}

		// Callback for when everything is done
		function done( status, nativeStatusText, responses, headers ) {
			var isSuccess, success, error, response, modified,
				statusText = nativeStatusText;

			// Ignore repeat invocations
			if ( completed ) {
				return;
			}

			completed = true;

			// Clear timeout if it exists
			if ( timeoutTimer ) {
				window.clearTimeout( timeoutTimer );
			}

			// Dereference transport for early garbage collection
			// (no matter how long the jqXHR object will be used)
			transport = undefined;

			// Cache response headers
			responseHeadersString = headers || "";

			// Set readyState
			jqXHR.readyState = status > 0 ? 4 : 0;

			// Determine if successful
			isSuccess = status >= 200 && status < 300 || status === 304;

			// Get response data
			if ( responses ) {
				response = ajaxHandleResponses( s, jqXHR, responses );
			}

			// Use a noop converter for missing script
			if ( !isSuccess && jQuery.inArray( "script", s.dataTypes ) > -1 ) {
				s.converters[ "text script" ] = function() {};
			}

			// Convert no matter what (that way responseXXX fields are always set)
			response = ajaxConvert( s, response, jqXHR, isSuccess );

			// If successful, handle type chaining
			if ( isSuccess ) {

				// Set the If-Modified-Since and/or If-None-Match header, if in ifModified mode.
				if ( s.ifModified ) {
					modified = jqXHR.getResponseHeader( "Last-Modified" );
					if ( modified ) {
						jQuery.lastModified[ cacheURL ] = modified;
					}
					modified = jqXHR.getResponseHeader( "etag" );
					if ( modified ) {
						jQuery.etag[ cacheURL ] = modified;
					}
				}

				// if no content
				if ( status === 204 || s.type === "HEAD" ) {
					statusText = "nocontent";

				// if not modified
				} else if ( status === 304 ) {
					statusText = "notmodified";

				// If we have data, let's convert it
				} else {
					statusText = response.state;
					success = response.data;
					error = response.error;
					isSuccess = !error;
				}
			} else {

				// Extract error from statusText and normalize for non-aborts
				error = statusText;
				if ( status || !statusText ) {
					statusText = "error";
					if ( status < 0 ) {
						status = 0;
					}
				}
			}

			// Set data for the fake xhr object
			jqXHR.status = status;
			jqXHR.statusText = ( nativeStatusText || statusText ) + "";

			// Success/Error
			if ( isSuccess ) {
				deferred.resolveWith( callbackContext, [ success, statusText, jqXHR ] );
			} else {
				deferred.rejectWith( callbackContext, [ jqXHR, statusText, error ] );
			}

			// Status-dependent callbacks
			jqXHR.statusCode( statusCode );
			statusCode = undefined;

			if ( fireGlobals ) {
				globalEventContext.trigger( isSuccess ? "ajaxSuccess" : "ajaxError",
					[ jqXHR, s, isSuccess ? success : error ] );
			}

			// Complete
			completeDeferred.fireWith( callbackContext, [ jqXHR, statusText ] );

			if ( fireGlobals ) {
				globalEventContext.trigger( "ajaxComplete", [ jqXHR, s ] );

				// Handle the global AJAX counter
				if ( !( --jQuery.active ) ) {
					jQuery.event.trigger( "ajaxStop" );
				}
			}
		}

		return jqXHR;
	},

	getJSON: function( url, data, callback ) {
		return jQuery.get( url, data, callback, "json" );
	},

	getScript: function( url, callback ) {
		return jQuery.get( url, undefined, callback, "script" );
	}
} );

jQuery.each( [ "get", "post" ], function( _i, method ) {
	jQuery[ method ] = function( url, data, callback, type ) {

		// Shift arguments if data argument was omitted
		if ( isFunction( data ) ) {
			type = type || callback;
			callback = data;
			data = undefined;
		}

		// The url can be an options object (which then must have .url)
		return jQuery.ajax( jQuery.extend( {
			url: url,
			type: method,
			dataType: type,
			data: data,
			success: callback
		}, jQuery.isPlainObject( url ) && url ) );
	};
} );

jQuery.ajaxPrefilter( function( s ) {
	var i;
	for ( i in s.headers ) {
		if ( i.toLowerCase() === "content-type" ) {
			s.contentType = s.headers[ i ] || "";
		}
	}
} );


jQuery._evalUrl = function( url, options, doc ) {
	return jQuery.ajax( {
		url: url,

		// Make this explicit, since user can override this through ajaxSetup (#11264)
		type: "GET",
		dataType: "script",
		cache: true,
		async: false,
		global: false,

		// Only evaluate the response if it is successful (gh-4126)
		// dataFilter is not invoked for failure responses, so using it instead
		// of the default converter is kludgy but it works.
		converters: {
			"text script": function() {}
		},
		dataFilter: function( response ) {
			jQuery.globalEval( response, options, doc );
		}
	} );
};


jQuery.fn.extend( {
	wrapAll: function( html ) {
		var wrap;

		if ( this[ 0 ] ) {
			if ( isFunction( html ) ) {
				html = html.call( this[ 0 ] );
			}

			// The elements to wrap the target around
			wrap = jQuery( html, this[ 0 ].ownerDocument ).eq( 0 ).clone( true );

			if ( this[ 0 ].parentNode ) {
				wrap.insertBefore( this[ 0 ] );
			}

			wrap.map( function() {
				var elem = this;

				while ( elem.firstElementChild ) {
					elem = elem.firstElementChild;
				}

				return elem;
			} ).append( this );
		}

		return this;
	},

	wrapInner: function( html ) {
		if ( isFunction( html ) ) {
			return this.each( function( i ) {
				jQuery( this ).wrapInner( html.call( this, i ) );
			} );
		}

		return this.each( function() {
			var self = jQuery( this ),
				contents = self.contents();

			if ( contents.length ) {
				contents.wrapAll( html );

			} else {
				self.append( html );
			}
		} );
	},

	wrap: function( html ) {
		var htmlIsFunction = isFunction( html );

		return this.each( function( i ) {
			jQuery( this ).wrapAll( htmlIsFunction ? html.call( this, i ) : html );
		} );
	},

	unwrap: function( selector ) {
		this.parent( selector ).not( "body" ).each( function() {
			jQuery( this ).replaceWith( this.childNodes );
		} );
		return this;
	}
} );


jQuery.expr.pseudos.hidden = function( elem ) {
	return !jQuery.expr.pseudos.visible( elem );
};
jQuery.expr.pseudos.visible = function( elem ) {
	return !!( elem.offsetWidth || elem.offsetHeight || elem.getClientRects().length );
};




jQuery.ajaxSettings.xhr = function() {
	try {
		return new window.XMLHttpRequest();
	} catch ( e ) {}
};

var xhrSuccessStatus = {

		// File protocol always yields status code 0, assume 200
		0: 200,

		// Support: IE <=9 only
		// #1450: sometimes IE returns 1223 when it should be 204
		1223: 204
	},
	xhrSupported = jQuery.ajaxSettings.xhr();

support.cors = !!xhrSupported && ( "withCredentials" in xhrSupported );
support.ajax = xhrSupported = !!xhrSupported;

jQuery.ajaxTransport( function( options ) {
	var callback, errorCallback;

	// Cross domain only allowed if supported through XMLHttpRequest
	if ( support.cors || xhrSupported && !options.crossDomain ) {
		return {
			send: function( headers, complete ) {
				var i,
					xhr = options.xhr();

				xhr.open(
					options.type,
					options.url,
					options.async,
					options.username,
					options.password
				);

				// Apply custom fields if provided
				if ( options.xhrFields ) {
					for ( i in options.xhrFields ) {
						xhr[ i ] = options.xhrFields[ i ];
					}
				}

				// Override mime type if needed
				if ( options.mimeType && xhr.overrideMimeType ) {
					xhr.overrideMimeType( options.mimeType );
				}

				// X-Requested-With header
				// For cross-domain requests, seeing as conditions for a preflight are
				// akin to a jigsaw puzzle, we simply never set it to be sure.
				// (it can always be set on a per-request basis or even using ajaxSetup)
				// For same-domain requests, won't change header if already provided.
				if ( !options.crossDomain && !headers[ "X-Requested-With" ] ) {
					headers[ "X-Requested-With" ] = "XMLHttpRequest";
				}

				// Set headers
				for ( i in headers ) {
					xhr.setRequestHeader( i, headers[ i ] );
				}

				// Callback
				callback = function( type ) {
					return function() {
						if ( callback ) {
							callback = errorCallback = xhr.onload =
								xhr.onerror = xhr.onabort = xhr.ontimeout =
									xhr.onreadystatechange = null;

							if ( type === "abort" ) {
								xhr.abort();
							} else if ( type === "error" ) {

								// Support: IE <=9 only
								// On a manual native abort, IE9 throws
								// errors on any property access that is not readyState
								if ( typeof xhr.status !== "number" ) {
									complete( 0, "error" );
								} else {
									complete(

										// File: protocol always yields status 0; see #8605, #14207
										xhr.status,
										xhr.statusText
									);
								}
							} else {
								complete(
									xhrSuccessStatus[ xhr.status ] || xhr.status,
									xhr.statusText,

									// Support: IE <=9 only
									// IE9 has no XHR2 but throws on binary (trac-11426)
									// For XHR2 non-text, let the caller handle it (gh-2498)
									( xhr.responseType || "text" ) !== "text"  ||
									typeof xhr.responseText !== "string" ?
										{ binary: xhr.response } :
										{ text: xhr.responseText },
									xhr.getAllResponseHeaders()
								);
							}
						}
					};
				};

				// Listen to events
				xhr.onload = callback();
				errorCallback = xhr.onerror = xhr.ontimeout = callback( "error" );

				// Support: IE 9 only
				// Use onreadystatechange to replace onabort
				// to handle uncaught aborts
				if ( xhr.onabort !== undefined ) {
					xhr.onabort = errorCallback;
				} else {
					xhr.onreadystatechange = function() {

						// Check readyState before timeout as it changes
						if ( xhr.readyState === 4 ) {

							// Allow onerror to be called first,
							// but that will not handle a native abort
							// Also, save errorCallback to a variable
							// as xhr.onerror cannot be accessed
							window.setTimeout( function() {
								if ( callback ) {
									errorCallback();
								}
							} );
						}
					};
				}

				// Create the abort callback
				callback = callback( "abort" );

				try {

					// Do send the request (this may raise an exception)
					xhr.send( options.hasContent && options.data || null );
				} catch ( e ) {

					// #14683: Only rethrow if this hasn't been notified as an error yet
					if ( callback ) {
						throw e;
					}
				}
			},

			abort: function() {
				if ( callback ) {
					callback();
				}
			}
		};
	}
} );




// Prevent auto-execution of scripts when no explicit dataType was provided (See gh-2432)
jQuery.ajaxPrefilter( function( s ) {
	if ( s.crossDomain ) {
		s.contents.script = false;
	}
} );

// Install script dataType
jQuery.ajaxSetup( {
	accepts: {
		script: "text/javascript, application/javascript, " +
			"application/ecmascript, application/x-ecmascript"
	},
	contents: {
		script: /\b(?:java|ecma)script\b/
	},
	converters: {
		"text script": function( text ) {
			jQuery.globalEval( text );
			return text;
		}
	}
} );

// Handle cache's special case and crossDomain
jQuery.ajaxPrefilter( "script", function( s ) {
	if ( s.cache === undefined ) {
		s.cache = false;
	}
	if ( s.crossDomain ) {
		s.type = "GET";
	}
} );

// Bind script tag hack transport
jQuery.ajaxTransport( "script", function( s ) {

	// This transport only deals with cross domain or forced-by-attrs requests
	if ( s.crossDomain || s.scriptAttrs ) {
		var script, callback;
		return {
			send: function( _, complete ) {
				script = jQuery( "<script>" )
					.attr( s.scriptAttrs || {} )
					.prop( { charset: s.scriptCharset, src: s.url } )
					.on( "load error", callback = function( evt ) {
						script.remove();
						callback = null;
						if ( evt ) {
							complete( evt.type === "error" ? 404 : 200, evt.type );
						}
					} );

				// Use native DOM manipulation to avoid our domManip AJAX trickery
				document.head.appendChild( script[ 0 ] );
			},
			abort: function() {
				if ( callback ) {
					callback();
				}
			}
		};
	}
} );




var oldCallbacks = [],
	rjsonp = /(=)\?(?=&|$)|\?\?/;

// Default jsonp settings
jQuery.ajaxSetup( {
	jsonp: "callback",
	jsonpCallback: function() {
		var callback = oldCallbacks.pop() || ( jQuery.expando + "_" + ( nonce.guid++ ) );
		this[ callback ] = true;
		return callback;
	}
} );

// Detect, normalize options and install callbacks for jsonp requests
jQuery.ajaxPrefilter( "json jsonp", function( s, originalSettings, jqXHR ) {

	var callbackName, overwritten, responseContainer,
		jsonProp = s.jsonp !== false && ( rjsonp.test( s.url ) ?
			"url" :
			typeof s.data === "string" &&
				( s.contentType || "" )
					.indexOf( "application/x-www-form-urlencoded" ) === 0 &&
				rjsonp.test( s.data ) && "data"
		);

	// Handle iff the expected data type is "jsonp" or we have a parameter to set
	if ( jsonProp || s.dataTypes[ 0 ] === "jsonp" ) {

		// Get callback name, remembering preexisting value associated with it
		callbackName = s.jsonpCallback = isFunction( s.jsonpCallback ) ?
			s.jsonpCallback() :
			s.jsonpCallback;

		// Insert callback into url or form data
		if ( jsonProp ) {
			s[ jsonProp ] = s[ jsonProp ].replace( rjsonp, "$1" + callbackName );
		} else if ( s.jsonp !== false ) {
			s.url += ( rquery.test( s.url ) ? "&" : "?" ) + s.jsonp + "=" + callbackName;
		}

		// Use data converter to retrieve json after script execution
		s.converters[ "script json" ] = function() {
			if ( !responseContainer ) {
				jQuery.error( callbackName + " was not called" );
			}
			return responseContainer[ 0 ];
		};

		// Force json dataType
		s.dataTypes[ 0 ] = "json";

		// Install callback
		overwritten = window[ callbackName ];
		window[ callbackName ] = function() {
			responseContainer = arguments;
		};

		// Clean-up function (fires after converters)
		jqXHR.always( function() {

			// If previous value didn't exist - remove it
			if ( overwritten === undefined ) {
				jQuery( window ).removeProp( callbackName );

			// Otherwise restore preexisting value
			} else {
				window[ callbackName ] = overwritten;
			}

			// Save back as free
			if ( s[ callbackName ] ) {

				// Make sure that re-using the options doesn't screw things around
				s.jsonpCallback = originalSettings.jsonpCallback;

				// Save the callback name for future use
				oldCallbacks.push( callbackName );
			}

			// Call if it was a function and we have a response
			if ( responseContainer && isFunction( overwritten ) ) {
				overwritten( responseContainer[ 0 ] );
			}

			responseContainer = overwritten = undefined;
		} );

		// Delegate to script
		return "script";
	}
} );




// Support: Safari 8 only
// In Safari 8 documents created via document.implementation.createHTMLDocument
// collapse sibling forms: the second one becomes a child of the first one.
// Because of that, this security measure has to be disabled in Safari 8.
// https://bugs.webkit.org/show_bug.cgi?id=137337
support.createHTMLDocument = ( function() {
	var body = document.implementation.createHTMLDocument( "" ).body;
	body.innerHTML = "<form></form><form></form>";
	return body.childNodes.length === 2;
} )();


// Argument "data" should be string of html
// context (optional): If specified, the fragment will be created in this context,
// defaults to document
// keepScripts (optional): If true, will include scripts passed in the html string
jQuery.parseHTML = function( data, context, keepScripts ) {
	if ( typeof data !== "string" ) {
		return [];
	}
	if ( typeof context === "boolean" ) {
		keepScripts = context;
		context = false;
	}

	var base, parsed, scripts;

	if ( !context ) {

		// Stop scripts or inline event handlers from being executed immediately
		// by using document.implementation
		if ( support.createHTMLDocument ) {
			context = document.implementation.createHTMLDocument( "" );

			// Set the base href for the created document
			// so any parsed elements with URLs
			// are based on the document's URL (gh-2965)
			base = context.createElement( "base" );
			base.href = document.location.href;
			context.head.appendChild( base );
		} else {
			context = document;
		}
	}

	parsed = rsingleTag.exec( data );
	scripts = !keepScripts && [];

	// Single tag
	if ( parsed ) {
		return [ context.createElement( parsed[ 1 ] ) ];
	}

	parsed = buildFragment( [ data ], context, scripts );

	if ( scripts && scripts.length ) {
		jQuery( scripts ).remove();
	}

	return jQuery.merge( [], parsed.childNodes );
};


/**
 * Load a url into a page
 */
jQuery.fn.load = function( url, params, callback ) {
	var selector, type, response,
		self = this,
		off = url.indexOf( " " );

	if ( off > -1 ) {
		selector = stripAndCollapse( url.slice( off ) );
		url = url.slice( 0, off );
	}

	// If it's a function
	if ( isFunction( params ) ) {

		// We assume that it's the callback
		callback = params;
		params = undefined;

	// Otherwise, build a param string
	} else if ( params && typeof params === "object" ) {
		type = "POST";
	}

	// If we have elements to modify, make the request
	if ( self.length > 0 ) {
		jQuery.ajax( {
			url: url,

			// If "type" variable is undefined, then "GET" method will be used.
			// Make value of this field explicit since
			// user can override it through ajaxSetup method
			type: type || "GET",
			dataType: "html",
			data: params
		} ).done( function( responseText ) {

			// Save response for use in complete callback
			response = arguments;

			self.html( selector ?

				// If a selector was specified, locate the right elements in a dummy div
				// Exclude scripts to avoid IE 'Permission Denied' errors
				jQuery( "<div>" ).append( jQuery.parseHTML( responseText ) ).find( selector ) :

				// Otherwise use the full result
				responseText );

		// If the request succeeds, this function gets "data", "status", "jqXHR"
		// but they are ignored because response was set above.
		// If it fails, this function gets "jqXHR", "status", "error"
		} ).always( callback && function( jqXHR, status ) {
			self.each( function() {
				callback.apply( this, response || [ jqXHR.responseText, status, jqXHR ] );
			} );
		} );
	}

	return this;
};




jQuery.expr.pseudos.animated = function( elem ) {
	return jQuery.grep( jQuery.timers, function( fn ) {
		return elem === fn.elem;
	} ).length;
};




jQuery.offset = {
	setOffset: function( elem, options, i ) {
		var curPosition, curLeft, curCSSTop, curTop, curOffset, curCSSLeft, calculatePosition,
			position = jQuery.css( elem, "position" ),
			curElem = jQuery( elem ),
			props = {};

		// Set position first, in-case top/left are set even on static elem
		if ( position === "static" ) {
			elem.style.position = "relative";
		}

		curOffset = curElem.offset();
		curCSSTop = jQuery.css( elem, "top" );
		curCSSLeft = jQuery.css( elem, "left" );
		calculatePosition = ( position === "absolute" || position === "fixed" ) &&
			( curCSSTop + curCSSLeft ).indexOf( "auto" ) > -1;

		// Need to be able to calculate position if either
		// top or left is auto and position is either absolute or fixed
		if ( calculatePosition ) {
			curPosition = curElem.position();
			curTop = curPosition.top;
			curLeft = curPosition.left;

		} else {
			curTop = parseFloat( curCSSTop ) || 0;
			curLeft = parseFloat( curCSSLeft ) || 0;
		}

		if ( isFunction( options ) ) {

			// Use jQuery.extend here to allow modification of coordinates argument (gh-1848)
			options = options.call( elem, i, jQuery.extend( {}, curOffset ) );
		}

		if ( options.top != null ) {
			props.top = ( options.top - curOffset.top ) + curTop;
		}
		if ( options.left != null ) {
			props.left = ( options.left - curOffset.left ) + curLeft;
		}

		if ( "using" in options ) {
			options.using.call( elem, props );

		} else {
			if ( typeof props.top === "number" ) {
				props.top += "px";
			}
			if ( typeof props.left === "number" ) {
				props.left += "px";
			}
			curElem.css( props );
		}
	}
};

jQuery.fn.extend( {

	// offset() relates an element's border box to the document origin
	offset: function( options ) {

		// Preserve chaining for setter
		if ( arguments.length ) {
			return options === undefined ?
				this :
				this.each( function( i ) {
					jQuery.offset.setOffset( this, options, i );
				} );
		}

		var rect, win,
			elem = this[ 0 ];

		if ( !elem ) {
			return;
		}

		// Return zeros for disconnected and hidden (display: none) elements (gh-2310)
		// Support: IE <=11 only
		// Running getBoundingClientRect on a
		// disconnected node in IE throws an error
		if ( !elem.getClientRects().length ) {
			return { top: 0, left: 0 };
		}

		// Get document-relative position by adding viewport scroll to viewport-relative gBCR
		rect = elem.getBoundingClientRect();
		win = elem.ownerDocument.defaultView;
		return {
			top: rect.top + win.pageYOffset,
			left: rect.left + win.pageXOffset
		};
	},

	// position() relates an element's margin box to its offset parent's padding box
	// This corresponds to the behavior of CSS absolute positioning
	position: function() {
		if ( !this[ 0 ] ) {
			return;
		}

		var offsetParent, offset, doc,
			elem = this[ 0 ],
			parentOffset = { top: 0, left: 0 };

		// position:fixed elements are offset from the viewport, which itself always has zero offset
		if ( jQuery.css( elem, "position" ) === "fixed" ) {

			// Assume position:fixed implies availability of getBoundingClientRect
			offset = elem.getBoundingClientRect();

		} else {
			offset = this.offset();

			// Account for the *real* offset parent, which can be the document or its root element
			// when a statically positioned element is identified
			doc = elem.ownerDocument;
			offsetParent = elem.offsetParent || doc.documentElement;
			while ( offsetParent &&
				( offsetParent === doc.body || offsetParent === doc.documentElement ) &&
				jQuery.css( offsetParent, "position" ) === "static" ) {

				offsetParent = offsetParent.parentNode;
			}
			if ( offsetParent && offsetParent !== elem && offsetParent.nodeType === 1 ) {

				// Incorporate borders into its offset, since they are outside its content origin
				parentOffset = jQuery( offsetParent ).offset();
				parentOffset.top += jQuery.css( offsetParent, "borderTopWidth", true );
				parentOffset.left += jQuery.css( offsetParent, "borderLeftWidth", true );
			}
		}

		// Subtract parent offsets and element margins
		return {
			top: offset.top - parentOffset.top - jQuery.css( elem, "marginTop", true ),
			left: offset.left - parentOffset.left - jQuery.css( elem, "marginLeft", true )
		};
	},

	// This method will return documentElement in the following cases:
	// 1) For the element inside the iframe without offsetParent, this method will return
	//    documentElement of the parent window
	// 2) For the hidden or detached element
	// 3) For body or html element, i.e. in case of the html node - it will return itself
	//
	// but those exceptions were never presented as a real life use-cases
	// and might be considered as more preferable results.
	//
	// This logic, however, is not guaranteed and can change at any point in the future
	offsetParent: function() {
		return this.map( function() {
			var offsetParent = this.offsetParent;

			while ( offsetParent && jQuery.css( offsetParent, "position" ) === "static" ) {
				offsetParent = offsetParent.offsetParent;
			}

			return offsetParent || documentElement;
		} );
	}
} );

// Create scrollLeft and scrollTop methods
jQuery.each( { scrollLeft: "pageXOffset", scrollTop: "pageYOffset" }, function( method, prop ) {
	var top = "pageYOffset" === prop;

	jQuery.fn[ method ] = function( val ) {
		return access( this, function( elem, method, val ) {

			// Coalesce documents and windows
			var win;
			if ( isWindow( elem ) ) {
				win = elem;
			} else if ( elem.nodeType === 9 ) {
				win = elem.defaultView;
			}

			if ( val === undefined ) {
				return win ? win[ prop ] : elem[ method ];
			}

			if ( win ) {
				win.scrollTo(
					!top ? val : win.pageXOffset,
					top ? val : win.pageYOffset
				);

			} else {
				elem[ method ] = val;
			}
		}, method, val, arguments.length );
	};
} );

// Support: Safari <=7 - 9.1, Chrome <=37 - 49
// Add the top/left cssHooks using jQuery.fn.position
// Webkit bug: https://bugs.webkit.org/show_bug.cgi?id=29084
// Blink bug: https://bugs.chromium.org/p/chromium/issues/detail?id=589347
// getComputedStyle returns percent when specified for top/left/bottom/right;
// rather than make the css module depend on the offset module, just check for it here
jQuery.each( [ "top", "left" ], function( _i, prop ) {
	jQuery.cssHooks[ prop ] = addGetHookIf( support.pixelPosition,
		function( elem, computed ) {
			if ( computed ) {
				computed = curCSS( elem, prop );

				// If curCSS returns percentage, fallback to offset
				return rnumnonpx.test( computed ) ?
					jQuery( elem ).position()[ prop ] + "px" :
					computed;
			}
		}
	);
} );


// Create innerHeight, innerWidth, height, width, outerHeight and outerWidth methods
jQuery.each( { Height: "height", Width: "width" }, function( name, type ) {
	jQuery.each( { padding: "inner" + name, content: type, "": "outer" + name },
		function( defaultExtra, funcName ) {

		// Margin is only for outerHeight, outerWidth
		jQuery.fn[ funcName ] = function( margin, value ) {
			var chainable = arguments.length && ( defaultExtra || typeof margin !== "boolean" ),
				extra = defaultExtra || ( margin === true || value === true ? "margin" : "border" );

			return access( this, function( elem, type, value ) {
				var doc;

				if ( isWindow( elem ) ) {

					// $( window ).outerWidth/Height return w/h including scrollbars (gh-1729)
					return funcName.indexOf( "outer" ) === 0 ?
						elem[ "inner" + name ] :
						elem.document.documentElement[ "client" + name ];
				}

				// Get document width or height
				if ( elem.nodeType === 9 ) {
					doc = elem.documentElement;

					// Either scroll[Width/Height] or offset[Width/Height] or client[Width/Height],
					// whichever is greatest
					return Math.max(
						elem.body[ "scroll" + name ], doc[ "scroll" + name ],
						elem.body[ "offset" + name ], doc[ "offset" + name ],
						doc[ "client" + name ]
					);
				}

				return value === undefined ?

					// Get width or height on the element, requesting but not forcing parseFloat
					jQuery.css( elem, type, extra ) :

					// Set width or height on the element
					jQuery.style( elem, type, value, extra );
			}, type, chainable ? margin : undefined, chainable );
		};
	} );
} );


jQuery.each( [
	"ajaxStart",
	"ajaxStop",
	"ajaxComplete",
	"ajaxError",
	"ajaxSuccess",
	"ajaxSend"
], function( _i, type ) {
	jQuery.fn[ type ] = function( fn ) {
		return this.on( type, fn );
	};
} );




jQuery.fn.extend( {

	bind: function( types, data, fn ) {
		return this.on( types, null, data, fn );
	},
	unbind: function( types, fn ) {
		return this.off( types, null, fn );
	},

	delegate: function( selector, types, data, fn ) {
		return this.on( types, selector, data, fn );
	},
	undelegate: function( selector, types, fn ) {

		// ( namespace ) or ( selector, types [, fn] )
		return arguments.length === 1 ?
			this.off( selector, "**" ) :
			this.off( types, selector || "**", fn );
	},

	hover: function( fnOver, fnOut ) {
		return this.mouseenter( fnOver ).mouseleave( fnOut || fnOver );
	}
} );

jQuery.each( ( "blur focus focusin focusout resize scroll click dblclick " +
	"mousedown mouseup mousemove mouseover mouseout mouseenter mouseleave " +
	"change select submit keydown keypress keyup contextmenu" ).split( " " ),
	function( _i, name ) {

		// Handle event binding
		jQuery.fn[ name ] = function( data, fn ) {
			return arguments.length > 0 ?
				this.on( name, null, data, fn ) :
				this.trigger( name );
		};
	} );




// Support: Android <=4.0 only
// Make sure we trim BOM and NBSP
var rtrim = /^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g;

// Bind a function to a context, optionally partially applying any
// arguments.
// jQuery.proxy is deprecated to promote standards (specifically Function#bind)
// However, it is not slated for removal any time soon
jQuery.proxy = function( fn, context ) {
	var tmp, args, proxy;

	if ( typeof context === "string" ) {
		tmp = fn[ context ];
		context = fn;
		fn = tmp;
	}

	// Quick check to determine if target is callable, in the spec
	// this throws a TypeError, but we will just return undefined.
	if ( !isFunction( fn ) ) {
		return undefined;
	}

	// Simulated bind
	args = slice.call( arguments, 2 );
	proxy = function() {
		return fn.apply( context || this, args.concat( slice.call( arguments ) ) );
	};

	// Set the guid of unique handler to the same of original handler, so it can be removed
	proxy.guid = fn.guid = fn.guid || jQuery.guid++;

	return proxy;
};

jQuery.holdReady = function( hold ) {
	if ( hold ) {
		jQuery.readyWait++;
	} else {
		jQuery.ready( true );
	}
};
jQuery.isArray = Array.isArray;
jQuery.parseJSON = JSON.parse;
jQuery.nodeName = nodeName;
jQuery.isFunction = isFunction;
jQuery.isWindow = isWindow;
jQuery.camelCase = camelCase;
jQuery.type = toType;

jQuery.now = Date.now;

jQuery.isNumeric = function( obj ) {

	// As of jQuery 3.0, isNumeric is limited to
	// strings and numbers (primitives or objects)
	// that can be coerced to finite numbers (gh-2662)
	var type = jQuery.type( obj );
	return ( type === "number" || type === "string" ) &&

		// parseFloat NaNs numeric-cast false positives ("")
		// ...but misinterprets leading-number strings, particularly hex literals ("0x...")
		// subtraction forces infinities to NaN
		!isNaN( obj - parseFloat( obj ) );
};

jQuery.trim = function( text ) {
	return text == null ?
		"" :
		( text + "" ).replace( rtrim, "" );
};



// Register as a named AMD module, since jQuery can be concatenated with other
// files that may use define, but not via a proper concatenation script that
// understands anonymous AMD modules. A named AMD is safest and most robust
// way to register. Lowercase jquery is used because AMD module names are
// derived from file names, and jQuery is normally delivered in a lowercase
// file name. Do this after creating the global so that if an AMD module wants
// to call noConflict to hide this version of jQuery, it will work.

// Note that for maximum portability, libraries that are not jQuery should
// declare themselves as anonymous modules, and avoid setting a global if an
// AMD loader is present. jQuery is a special case. For more information, see
// https://github.com/jrburke/requirejs/wiki/Updating-existing-libraries#wiki-anon

if ( typeof define === "function" && define.amd ) {
	define( "jquery", [], function() {
		return jQuery;
	} );
}




var

	// Map over jQuery in case of overwrite
	_jQuery = window.jQuery,

	// Map over the $ in case of overwrite
	_$ = window.$;

jQuery.noConflict = function( deep ) {
	if ( window.$ === jQuery ) {
		window.$ = _$;
	}

	if ( deep && window.jQuery === jQuery ) {
		window.jQuery = _jQuery;
	}

	return jQuery;
};

// Expose jQuery and $ identifiers, even in AMD
// (#7102#comment:10, https://github.com/jquery/jquery/pull/557)
// and CommonJS for browser emulators (#13566)
if ( typeof noGlobal === "undefined" ) {
	window.jQuery = window.$ = jQuery;
}




return jQuery;
} );

/**
 * 
 * @param {Function} a
 * @param {Function} b
 */
function add(a, b) {
    return evt => {
        a(evt);
        b(evt);
    };
}

/**
 * Wait for a specific event, one time.
 * @param {import("./EventBase").EventBase|EventTarget} target - the event target.
 * @param {string} resolveEvt - the name of the event that will resolve the Promise this method creates.
 * @param {string} rejectEvt - the name of the event that could reject the Promise this method creates.
 * @param {number} timeout - the number of milliseconds to wait for the resolveEvt, before rejecting.
 */
function once(target, resolveEvt, rejectEvt, timeout) {

    if (timeout === undefined
        && isGoodNumber(rejectEvt)) {
        timeout = rejectEvt;
        rejectEvt = undefined;
    }

    return new Promise((resolve, reject) => {
        const hasResolveEvt = isString(resolveEvt);
        if (hasResolveEvt) {
            const oldResolve = resolve;
            const remove = () => {
                target.removeEventListener(resolveEvt, oldResolve);
            };
            resolve = add(remove, resolve);
            reject = add(remove, reject);
        }

        const hasRejectEvt = isString(rejectEvt);
        if (hasRejectEvt) {
            const oldReject = reject;
            const remove = () => {
                target.removeEventListener(rejectEvt, oldReject);
            };

            resolve = add(remove, resolve);
            reject = add(remove, reject);
        }

        if (isNumber(timeout)) {
            const timer = setTimeout(reject, timeout, `'${resolveEvt}' has timed out.`),
                cancel = () => clearTimeout(timer);
            resolve = add(cancel, resolve);
            reject = add(cancel, reject);
        }

        if (hasResolveEvt) {
            target.addEventListener(resolveEvt, resolve);
        }

        if (hasRejectEvt) {
            target.addEventListener(rejectEvt, () => {
                reject("Rejection event found");
            });
        }
    });
}

/**
 * 
 * @param {import("./EventBase").EventBase|EventTarget} target
 * @param {string} untilEvt
 * @param {Function} callback
 * @param {Function} test
 * @param {number?} repeatTimeout
 * @param {number?} cancelTimeout
 */
function until(target, untilEvt, callback, test, repeatTimeout, cancelTimeout) {
    return new Promise((resolve, reject) => {
        let timer = null,
            canceller = null;

        const cleanup = () => {
            if (timer !== null) {
                clearTimeout(timer);
            }

            if (canceller !== null) {
                clearTimeout(canceller);
            }

            target.removeEventListener(untilEvt, success);
        };

        function success(evt) {
            if (test(evt)) {
                cleanup();
                resolve(evt);
            }
        }

        target.addEventListener(untilEvt, success);

        if (repeatTimeout !== undefined) {
            if (cancelTimeout !== undefined) {
                canceller = setTimeout(() => {
                    cleanup();
                    reject(`'${untilEvt}' has timed out.`);
                }, cancelTimeout);
            }

            const repeater = () => {
                callback();
                timer = setTimeout(repeater, repeatTimeout);
            };

            timer = setTimeout(repeater, 0);
        }
    });
}

/**
 * 
 * @param {import("./EventBase").EventBase|EventTarget} target
 * @param {string} resolveEvt
 * @param {Function} filterTest
 * @param {number?} timeout
 */
function when(target, resolveEvt, filterTest, timeout) {

    if (!isString(resolveEvt)) {
        throw new Error("Need an event name on which to resolve the operation.");
    }

    if (!isFunction(filterTest)) {
        throw new Error("Filtering tests function is required. Otherwise, use `once`.");
    }

    return new Promise((resolve, reject) => {
        const remove = () => {
            target.removeEventListener(resolveEvt, resolve);
        };

        resolve = add(remove, resolve);
        reject = add(remove, reject);

        if (isNumber(timeout)) {
            const timer = setTimeout(reject, timeout, `'${resolveEvt}' has timed out.`),
                cancel = () => clearTimeout(timer);
            resolve = add(cancel, resolve);
            reject = add(cancel, reject);
        }

        target.addEventListener(resolveEvt, resolve);
    });
}

const versionString = "v0.11.0";

/* global JitsiMeetJS */

console.info("Calla", versionString);

class CallaClientEvent extends Event {
    constructor(command, id, value) {
        super(command);
        this.id = id;
        for (let key in value) {
            if (key !== "isTrusted"
                && !Object.prototype.hasOwnProperty.call(Event.prototype, key)) {
                this[key] = value[key];
            }
        }
    }
}

// helps us filter out data channel messages that don't belong to us
const eventNames = [
    "userMoved",
    "userTurned",
    "userPosed",
    "emote",
    "userInitRequest",
    "userInitResponse",
    "audioMuteStatusChanged",
    "videoMuteStatusChanged",
    "localAudioMuteStatusChanged",
    "localVideoMuteStatusChanged",
    "videoConferenceJoined",
    "videoConferenceLeft",
    "participantJoined",
    "participantLeft",
    "avatarChanged",
    "displayNameChange",
    "audioActivity",
    "setAvatarEmoji",
    "deviceListChanged",
    "participantRoleChanged",
    "audioAdded",
    "videoAdded",
    "audioRemoved",
    "videoRemoved",
    "audioChanged",
    "videoChanged"
];

const audioActivityEvt$2 = new AudioActivityEvent();

function logger(source, evtName) {
    if (window.location.hostname === "localhost") {
        const handler = (...rest) => {
            if (evtName === "conference.endpoint_message_received"
                && rest.length >= 2
                && (rest[1].type === "e2e-ping-request"
                    || rest[1].type === "e2e-ping-response"
                    || rest[1].type === "stats")) {
                return;
            }
            console.log(evtName, ...rest);
        };

        source.addEventListener(evtName, handler);
    }
}

function setLoggers(source, evtObj) {
    for (let evtName of Object.values(evtObj)) {
        if (evtName.indexOf("audioLevelsChanged") === -1) {
            logger(source, evtName);
        }
    }
}

// Manages communication between Jitsi Meet and Calla
class CallaClient extends EventBase {

    /**
     * @param {string} JITSI_HOST
     * @param {string} JVB_HOST
     * @param {string} JVB_MUC
     */
    constructor(JITSI_HOST, JVB_HOST, JVB_MUC) {
        super();

        this.host = JITSI_HOST;
        this.bridgeHost = JVB_HOST;
        this.bridgeMUC = JVB_MUC;

        this._prepTask = null;
        this.joined = false;
        this.connection = null;
        this.conference = null;
        this.audio = new AudioManager();
        this.audio.addEventListener("audioActivity", (evt) => {
            audioActivityEvt$2.id = evt.id;
            audioActivityEvt$2.isActive = evt.isActive;
            this.dispatchEvent(audioActivityEvt$2);
        });

        this.hasAudioPermission = false;
        this.hasVideoPermission = false;

        /** @type {String} */
        this.localUserID = null;

        /** @type {String} */
        this.preferredAudioOutputID = null;

        /** @type {String} */
        this.preferredAudioInputID = null;

        /** @type {String} */
        this.preferredVideoInputID = null;

        this.addEventListener("participantJoined", async (evt) => {
            const response = await this.userInitRequestAsync(evt.id);

            if (isNumber(response.x)
                && isNumber(response.y)
                && isNumber(response.z)) {
                this.audio.setUserPosition(
                    response.id,
                    response.x, response.y, response.z);
            }
            else if (isNumber(response.fx)
                && isNumber(response.fy)
                && isNumber(response.fz)
                && isNumber(response.ux)
                && isNumber(response.uy)
                && isNumber(response.uz)) {
                if (isNumber(response.px)
                    && isNumber(response.py)
                    && isNumber(response.pz)) {
                    this.audio.setUserPose(
                        response.id,
                        response.px, response.py, response.pz,
                        response.fx, response.fy, response.fz,
                        response.ux, response.uy, response.uz);
                }
                else {
                    this.audio.setUserOrientation(
                        response.id,
                        response.fx, response.fy, response.fz,
                        response.ux, response.uy, response.uz);
                }
            }
        });

        this.addEventListener("userInitRequest", (evt) => {
            const user = this.audio.getUser(this.localUserID);
            const { p, f, u } = user.pose.end;
            this.userInitResponse(evt.id, {
                id: this.localUserID,
                px: p.x,
                py: p.y,
                pz: p.z,
                fx: f.x,
                fy: f.y,
                fz: f.z,
                ux: u.x,
                uy: u.y,
                uz: u.z
            });
        });

        this.addEventListener("userMoved", (evt) => {
            this.audio.setUserPosition(evt.id, evt.x, evt.y, evt.z);
        });

        this.addEventListener("userTurned", (evt) => {
            this.audio.setUserOrientation(evt.id, evt.fx, evt.fy, evt.fz, evt.ux, evt.uy, evt.uz);
        });

        this.addEventListener("userPosed", (evt) => {
            this.audio.setUserPose(evt.id, evt.px, evt.py, evt.pz, evt.fx, evt.fy, evt.fz, evt.ux, evt.uy, evt.uz);
        });

        this.addEventListener("participantLeft", (evt) => {
            this.removeUser(evt.id);
        });

        const onAudioChange = (evt) => {
            const evt2 = Object.assign(new Event("audioChanged"), {
                id: evt.id,
                stream: evt.stream
            });
            this.dispatchEvent(evt2);
        };

        const onVideoChange = (evt) => {
            const evt2 = Object.assign(new Event("videoChanged"), {
                id: evt.id,
                stream: evt.stream
            });
            this.dispatchEvent(evt2);
        };

        this.addEventListener("audioAdded", onAudioChange);
        this.addEventListener("audioRemoved", onAudioChange);
        this.addEventListener("videoAdded", onVideoChange);
        this.addEventListener("videoRemoved", onVideoChange);

        this.addEventListener("audioMuteStatusChanged", (evt) => {
            if (evt.id === this.localUserID) {
                const evt2 = Object.assign(new Event("localAudioMuteStatusChanged"), {
                    id: evt.id,
                    muted: evt.muted
                });
                this.dispatchEvent(evt2);
            }
        });

        this.addEventListener("videoMuteStatusChanged", (evt) => {
            if (evt.id === this.localUserID) {
                const evt2 = Object.assign(new Event("localVideoMuteStatusChanged"), {
                    id: evt.id,
                    muted: evt.muted
                });
                this.dispatchEvent(evt2);
            }
        });

        const dispose = () => this.dispose();
        window.addEventListener("beforeunload", dispose);
        window.addEventListener("unload", dispose);
        window.addEventListener("pagehide", dispose);

        Object.seal(this);
    }

    get appFingerPrint() {
        return "Calla";
    }

    userIDs() {
        return Object.keys(this.conference.participants);
    }

    userExists(id) {
        return !!this.conference.participants[id];
    }

    users() {
        return Object.keys(this.conference.participants)
            .map(k => [k, this.conference.participants[k].getDisplayName()]);
    }

    update() {
        this.audio.update();
    }

    _prepareAsync() {
        if (!this._prepTask) {
            console.info("Connecting to:", this.host);
            this._prepTask = import(`https://${this.host}/libs/lib-jitsi-meet.min.js`);
        }
        return this._prepTask;
    }

    /**
     * @param {string} roomName
     * @param {string} userName
     */
    async join(roomName, userName) {
        await this.leaveAsync();

        await this._prepareAsync();

        roomName = roomName.toLocaleLowerCase();

        JitsiMeetJS.setLogLevel(JitsiMeetJS.logLevels.ERROR);
        JitsiMeetJS.init();

        this.connection = new JitsiMeetJS.JitsiConnection(null, null, {
            hosts: {
                domain: this.bridgeHost,
                muc: this.bridgeMUC
            },
            serviceUrl: `https://${this.host}/http-bind`,
            enableLipSync: true
        });

        const {
            CONNECTION_ESTABLISHED,
            CONNECTION_FAILED,
            CONNECTION_DISCONNECTED
        } = JitsiMeetJS.events.connection;

        setLoggers(this.connection, JitsiMeetJS.events.connection);

        const onConferenceLeft = () => {
            this.dispatchEvent(Object.assign(
                new Event("videoConferenceLeft"), {
                roomName
            }));
            this.localUserID = null;
            this.conference = null;
            this.joined = false;
        };

        const onFailed = (evt) => {
            console.error("Connection failed", evt);
            this.dispose();
            onConferenceLeft();
            onDisconnect();
        };

        const onDisconnect = () => {
            this.connection.removeEventListener(CONNECTION_ESTABLISHED, onConnect);
            this.connection.removeEventListener(CONNECTION_FAILED, onFailed);
            this.connection.removeEventListener(CONNECTION_DISCONNECTED, onDisconnect);
            this.connection = null;
        };

        const onConnect = (connectionID) => {
            this.conference = this.connection.initJitsiConference(roomName, {
                openBridgeChannel: true
            });

            const {
                TRACK_ADDED,
                TRACK_REMOVED,
                CONFERENCE_JOINED,
                CONFERENCE_LEFT,
                USER_JOINED,
                USER_LEFT,
                DISPLAY_NAME_CHANGED,
                ENDPOINT_MESSAGE_RECEIVED,
                CONNECTION_INTERRUPTED
            } = JitsiMeetJS.events.conference;

            setLoggers(this.conference, JitsiMeetJS.events.conference);

            this.conference.addEventListener(CONFERENCE_JOINED, async () => {
                this.localUserID = this.conference.myUserId();
                console.log("======== CONFERENCE_JOINED ::", this.localUserID);
                const user = this.audio.createLocalUser(this.localUserID);
                this.joined = true;
                this.setDisplayName(userName);
                this.dispatchEvent(Object.assign(
                    new Event("videoConferenceJoined"), {
                    id: this.localUserID,
                    roomName,
                    displayName: userName,
                    pose: user.pose
                }));
                await this.setPreferredDevicesAsync();
            });

            this.conference.addEventListener(CONFERENCE_LEFT, onConferenceLeft);

            const onTrackMuteChanged = (track, muted) => {
                const userID = track.getParticipantId() || this.localUserID,
                    trackKind = track.getType(),
                    muteChangedEvtName = trackKind + "MuteStatusChanged",
                    evt = Object.assign(
                        new Event(muteChangedEvtName), {
                        id: userID,
                        muted
                    });

                this.dispatchEvent(evt);
            };

            const onTrackChanged = (track) => {
                onTrackMuteChanged(track, track.isMuted());
            };

            this.conference.addEventListener(USER_JOINED, (id, jitsiUser) => {
                console.log("======== USER_JOINED ::", id);
                const user = this.audio.createUser(id);
                const evt = Object.assign(
                    new Event("participantJoined"), {
                    id,
                    displayName: jitsiUser.getDisplayName(),
                    pose: user.pose
                });
                this.dispatchEvent(evt);
            });

            this.conference.addEventListener(USER_LEFT, (id) => {
                const evt = Object.assign(
                    new Event("participantLeft"), {
                    id
                });

                this.dispatchEvent(evt);
            });

            this.conference.addEventListener(DISPLAY_NAME_CHANGED, (id, displayName) => {
                const evt = Object.assign(
                    new Event("displayNameChange"), {
                    id,
                    displayName
                });

                this.dispatchEvent(evt);
            });

            this.conference.addEventListener(TRACK_ADDED, (track) => {
                const userID = track.getParticipantId() || this.localUserID,
                    isLocal = track.isLocal(),
                    trackKind = track.getType(),
                    trackAddedEvt = Object.assign(new Event(trackKind + "Added"), {
                        id: userID,
                        stream: track.stream
                    }),
                    user = this.audio.getUser(userID);

                setLoggers(track, JitsiMeetJS.events.track);

                track.addEventListener(JitsiMeetJS.events.track.TRACK_MUTE_CHANGED, onTrackChanged);

                if (user.tracks.has(trackKind)) {
                    user.tracks.get(trackKind).dispose();
                    user.tracks.delete(trackKind);
                }

                user.tracks.set(trackKind, track);

                if (trackKind === "audio" && !isLocal) {
                    this.audio.setUserStream(userID, track.stream);
                }

                this.dispatchEvent(trackAddedEvt);

                onTrackMuteChanged(track, false);
            });

            this.conference.addEventListener(TRACK_REMOVED, (track) => {

                const userID = track.getParticipantId() || this.localUserID,
                    isLocal = track.isLocal(),
                    trackKind = track.getType(),
                    trackRemovedEvt = Object.assign(new Event(trackKind + "Removed"), {
                        id: userID,
                        stream: null
                    }),
                    user = this.audio.getUser(userID);

                if (user && user.tracks.has(trackKind)) {
                    user.tracks.get(trackKind).dispose();
                    user.tracks.delete(trackKind);
                }

                if (trackKind === "audio" && !isLocal) {
                    this.audio.setUserStream(userID, null);
                }

                track.dispose();

                onTrackMuteChanged(track, true);
                this.dispatchEvent(trackRemovedEvt);
            });

            this.conference.addEventListener(ENDPOINT_MESSAGE_RECEIVED, (user, data) => {
                this.rxGameData({ user, data });
            });

            this.conference.addEventListener(CONNECTION_INTERRUPTED, (...rest) => {
                console.log("CONNECTION_INTERRUPTED");
                onFailed(rest);
            });

            this.conference.join();
        };

        this.connection.addEventListener(CONNECTION_ESTABLISHED, onConnect);
        this.connection.addEventListener(CONNECTION_FAILED, onFailed);
        this.connection.addEventListener(CONNECTION_DISCONNECTED, onDisconnect);

        setLoggers(JitsiMeetJS.mediaDevices, JitsiMeetJS.events.mediaDevices);

        this.connection.connect();
    }

    dispatchEvent(evt) {
        if (evt.id === null
            || evt.id === undefined
            || evt.id === "local") {
            if (this.localUserID === null) {
                console.warn("I DON'T KNOW THE LOCAL USER ID YET!");
            }
            evt.id = this.localUserID;
        }

        super.dispatchEvent(evt);
    }

    async setPreferredDevicesAsync() {
        await this.setPreferredAudioInputAsync(true);
        await this.setPreferredVideoInputAsync(false);
        await this.setPreferredAudioOutputAsync(true);
    }

    /**
     * @param {boolean} allowAny
     */
    async getPreferredAudioOutputAsync(allowAny) {
        const devices = await this.getAudioOutputDevicesAsync();
        const device = arrayScan(
            devices,
            (d) => d.deviceId === this.preferredAudioOutputID,
            (d) => d.deviceId === "communications",
            (d) => d.deviceId === "default",
            (d) => allowAny && d && d.deviceId);
        return device;
    }

    /**
     * @param {boolean} allowAny
     */
    async setPreferredAudioOutputAsync(allowAny) {
        const device = await this.getPreferredAudioOutputAsync(allowAny);
        if (device) {
            await this.setAudioOutputDeviceAsync(device);
        }
    }

    /**
     * @param {boolean} allowAny
     */
    async getPreferredAudioInputAsync(allowAny) {
        const devices = await this.getAudioInputDevicesAsync();
        const device = arrayScan(
            devices,
            (d) => d.deviceId === this.preferredAudioInputID,
            (d) => d.deviceId === "communications",
            (d) => d.deviceId === "default",
            (d) => allowAny && d && d.deviceId);
        return device;
    }

    /**
     * @param {boolean} allowAny
     */
    async setPreferredAudioInputAsync(allowAny) {
        const device = await this.getPreferredAudioInputAsync(allowAny);
        if (device) {
            await this.setAudioInputDeviceAsync(device);
        }
    }

    /**
     * @param {boolean} allowAny
     */
    async getPreferredVideoInputAsync(allowAny) {
        const devices = await this.getVideoInputDevicesAsync();
        const device = arrayScan(devices,
            (d) => d.deviceId === this.preferredVideoInputID,
            (d) => allowAny && d && /front/i.test(d.label),
            (d) => allowAny && d && d.deviceId);
        return device;
    }

    /**
     * @param {boolean} allowAny
     */
    async setPreferredVideoInputAsync(allowAny) {
        const device = await this.getPreferredVideoInputAsync(allowAny);
        if (device) {
            await this.setVideoInputDeviceAsync(device);
        }
    }

    dispose() {
        if (this.localUserID) {
            const user = this.audio.getUser(this.localUserID);
            if (user) {
                for (let track of user.tracks.values()) {
                    track.dispose();
                }
            }
        }
    }

    /**
     * 
     * @param {string} userName
     */
    setDisplayName(userName) {
        this.conference.setDisplayName(userName);
    }

    async leaveAsync() {
        if (this.conference) {
            if (this.localUserID !== null) {
                const user = this.audio.getUser(this.localUserID);
                if (user) {
                    if (user.tracks.has("video")) {
                        const removeTrackTask = once(this, "videoRemoved");
                        this.conference.removeTrack(user.tracks.get("video"));
                        await removeTrackTask;
                    }

                    if (user.tracks.has("audio")) {
                        const removeTrackTask = once(this, "audioRemoved");
                        this.conference.removeTrack(user.tracks.get("audio"));
                        await removeTrackTask;
                    }
                }
            }

            await this.conference.leave();
            await this.connection.disconnect();
        }
    }

    async _getDevicesAsync() {
        await this._prepareAsync();
        const devices = await navigator.mediaDevices.enumerateDevices();
        for (let device of devices) {
            if (device.deviceId.length > 0) {
                this.hasAudioPermission |= device.kind === "audioinput" && device.label.length > 0;
                this.hasVideoPermission |= device.kind === "videoinput" && device.label.length > 0;
            }
        }

        return devices;
    }

    async getAvailableDevicesAsync() {
        let devices = await this._getDevicesAsync();

        for (let i = 0; i < 3 && !this.hasAudioPermission; ++i) {
            devices = null;
            try {
                const _ = await navigator.mediaDevices.getUserMedia({ audio: !this.hasAudioPermission, video: !this.hasVideoPermission });
            }
            catch (exp) {
                console.warn(exp);
            }

            devices = await this._getDevicesAsync();
        }

        return {
            audioOutput: canChangeAudioOutput ? devices.filter(d => d.kind === "audiooutput") : [],
            audioInput: devices.filter(d => d.kind === "audioinput"),
            videoInput: devices.filter(d => d.kind === "videoinput")
        };
    }

    async getAudioOutputDevicesAsync() {
        if (!canChangeAudioOutput) {
            return [];
        }
        const devices = await this.getAvailableDevicesAsync();
        return devices && devices.audioOutput || [];
    }

    async getAudioInputDevicesAsync() {
        const devices = await this.getAvailableDevicesAsync();
        return devices && devices.audioInput || [];
    }

    async getVideoInputDevicesAsync() {
        const devices = await this.getAvailableDevicesAsync();
        return devices && devices.videoInput || [];
    }

    /**
     * 
     * @param {MediaDeviceInfo} device
     */
    async setAudioOutputDeviceAsync(device) {
        if (!canChangeAudioOutput) {
            return;
        }
        this.preferredAudioOutputID = device && device.deviceId || null;
        await JitsiMeetJS.mediaDevices.setAudioOutputDevice(this.preferredAudioOutputID);
    }

    taskOf(evt) {
        return when(this, evt, (evt) => evt.id === this.localUserID, 5000);
    }

    getCurrentMediaTrack(type) {
        if (this.localUserID === null) {
            return null;
        }

        const user = this.audio.getUser(this.localUserID);
        if (!user) {
            return null;
        }

        if (!user.tracks.has(type)) {
            return null;
        }

        return user.tracks.get(type);
    }

    /**
     *
     * @param {MediaDeviceInfo} device
     */
    async setAudioInputDeviceAsync(device) {
        this.preferredAudioInputID = device && device.deviceId || null;

        const cur = this.getCurrentMediaTrack("audio");
        if (cur) {
            const removeTask = this.taskOf("audioRemoved");
            this.conference.removeTrack(cur);
            await removeTask;
        }

        if (this.joined && this.preferredAudioInputID) {
            const addTask = this.taskOf("audioAdded");
            const tracks = await JitsiMeetJS.createLocalTracks({
                devices: ["audio"],
                micDeviceId: this.preferredAudioInputID
            });

            for (let track of tracks) {
                this.conference.addTrack(track);
            }

            await addTask;
        }
    }

    /**
     *
     * @param {MediaDeviceInfo} device
     */
    async setVideoInputDeviceAsync(device) {
        this.preferredVideoInputID = device && device.deviceId || null;

        const cur = this.getCurrentMediaTrack("video");
        if (cur) {
            const removeTask = this.taskOf("videoRemoved");
            this.conference.removeTrack(cur);
            await removeTask;
        }

        if (this.joined && this.preferredVideoInputID) {
            const addTask = this.taskOf("videoAdded");
            const tracks = await JitsiMeetJS.createLocalTracks({
                devices: ["video"],
                cameraDeviceId: this.preferredVideoInputID
            });

            for (let track of tracks) {
                this.conference.addTrack(track);
            }

            await addTask;
        }
    }

    async getCurrentAudioInputDeviceAsync() {
        const cur = this.getCurrentMediaTrack("audio"),
            devices = await this.getAudioInputDevicesAsync(),
            device = devices.filter((d) => cur !== null && d.deviceId === cur.deviceId);
        if (device.length === 0) {
            return null;
        }
        else {
            return device[0];
        }
    }

    /**
     * @return {Promise<MediaDeviceInfo>} */
    async getCurrentAudioOutputDeviceAsync() {
        if (!canChangeAudioOutput) {
            return null;
        }
        const deviceId = JitsiMeetJS.mediaDevices.getAudioOutputDevice(),
            devices = await this.getAudioOutputDevicesAsync(),
            device = devices.filter((d) => d.deviceId === deviceId);
        if (device.length === 0) {
            return null;
        }
        else {
            return device[0];
        }
    }

    async getCurrentVideoInputDeviceAsync() {
        const cur = this.getCurrentMediaTrack("video"),
            devices = await this.getVideoInputDevicesAsync(),
            device = devices.filter((d) => cur !== null && d.deviceId === cur.deviceId);
        if (device.length === 0) {
            return null;
        }
        else {
            return device[0];
        }
    }

    async toggleAudioMutedAsync() {
        const changeTask = this.taskOf("audioMuteStatusChanged");
        const cur = this.getCurrentMediaTrack("audio");
        if (cur) {
            const muted = cur.isMuted();
            if (muted) {
                await cur.unmute();
            }
            else {
                await cur.mute();
            }
        }
        else {
            await this.setPreferredAudioInputAsync(true);
        }

        const evt = await changeTask;
        return evt.muted;
    }

    async toggleVideoMutedAsync() {
        const changeTask = this.taskOf("videoMuteStatusChanged");
        const cur = this.getCurrentMediaTrack("video");
        if (cur) {
            await this.setVideoInputDeviceAsync(null);
        }
        else {
            await this.setPreferredVideoInputAsync(true);
        }

        const evt = await changeTask;
        return evt.muted;
    }

    isMediaMuted(type) {
        const cur = this.getCurrentMediaTrack(type);
        return cur === null
            || cur.isMuted();
    }

    get isAudioMuted() {
        return this.isMediaMuted("audio");
    }

    get isVideoMuted() {
        return this.isMediaMuted("video");
    }

    txGameData(toUserID, data) {
        this.conference.sendMessage(data, toUserID);
    }

    /// A listener to add to JitsiExternalAPI::endpointTextMessageReceived event
    /// to receive Calla messages from the Jitsi Meet data channel.
    rxGameData(evt) {
        if (evt.data.hax === this.appFingerPrint) {
            this.receiveMessageFrom(evt.user.getId(), evt.data.command, evt.data.value);
        }
    }

    /// Send a Calla message through the Jitsi Meet data channel.
    sendMessageTo(toUserID, command, value) {
        this.txGameData(toUserID, {
            hax: this.appFingerPrint,
            command,
            value
        });
    }

    receiveMessageFrom(fromUserID, command, value) {
        const evt = new CallaClientEvent(command, fromUserID, value);
        this.dispatchEvent(evt);
    }

    /**
     * Sets parameters that alter spatialization.
     * @param {number} minDistance
     * @param {number} maxDistance
     * @param {number} rolloff
     * @param {number} transitionTime
     */
    setAudioProperties(minDistance, maxDistance, rolloff, transitionTime) {
        this.audio.setAudioProperties(minDistance, maxDistance, rolloff, transitionTime);
    }

    /**
     * Set the position of the listener.
     * @param {number} x - the horizontal component of the position.
     * @param {number} y - the vertical component of the position.
     * @param {number} z - the lateral component of the position.
     */
    setLocalPosition(x, y, z) {
        this.audio.setUserPosition(this.localUserID, x, y, z);
        for (let toUserID of this.userIDs()) {
            this.sendMessageTo(toUserID, "userMoved", { x, y, z });
        }
    }

    /**
     * Set the position of the listener.
     * @param {number} fx - the horizontal component of the forward vector.
     * @param {number} fy - the vertical component of the forward vector.
     * @param {number} fz - the lateral component of the forward vector.
     * @param {number} ux - the horizontal component of the up vector.
     * @param {number} uy - the vertical component of the up vector.
     * @param {number} uz - the lateral component of the up vector.
     */
    setLocalOrientation(fx, fy, fz, ux, uy, uz) {
        this.audio.setUserOrientation(this.localUserID, fx, fy, fz, ux, uy, uz);
        for (let toUserID of this.userIDs()) {
            this.sendMessageTo(toUserID, "userTurned", { fx, fy, fz, ux, uy, uz });
        }
    }

    /**
     * Set the position of the listener.
     * @param {number} px - the horizontal component of the position.
     * @param {number} py - the vertical component of the position.
     * @param {number} pz - the lateral component of the position.
     * @param {number} fx - the horizontal component of the forward vector.
     * @param {number} fy - the vertical component of the forward vector.
     * @param {number} fz - the lateral component of the forward vector.
     * @param {number} ux - the horizontal component of the up vector.
     * @param {number} uy - the vertical component of the up vector.
     * @param {number} uz - the lateral component of the up vector.
     */
    setLocalPose(px, py, pz, fx, fy, fz, ux, uy, uz) {
        this.audio.setUserPose(this.localUserID, px, py, pz, fx, fy, fz, ux, uy, uz);
        for (let toUserID of this.userIDs()) {
            this.sendMessageTo(toUserID, "userPosed", { px, py, pz, fx, fy, fz, ux, uy, uz });
        }
    }

    removeUser(id) {
        this.audio.removeUser(id);
    }

    /**
     *
     * @param {boolean} muted
     */
    async setAudioMutedAsync(muted) {
        let isMuted = this.isAudioMuted;
        if (muted !== isMuted) {
            isMuted = await this.toggleAudioMutedAsync();
        }
        return isMuted;
    }

    /**
     *
     * @param {boolean} muted
     */
    async setVideoMutedAsync(muted) {
        let isMuted = this.isVideoMuted;
        if (muted !== isMuted) {
            isMuted = await this.toggleVideoMutedAsync();
        }
        return isMuted;
    }

    /// Add a listener for Calla events that come through the Jitsi Meet data channel.
    /**
     * 
     * @param {string} evtName
     * @param {function} callback
     * @param {AddEventListenerOptions} opts
     */
    addEventListener(evtName, callback, opts) {
        if (eventNames.indexOf(evtName) === -1) {
            throw new Error(`Unsupported event type: ${evtName}`);
        }

        super.addEventListener(evtName, callback, opts);
    }

    /**
     * 
     * @param {string} toUserID
     */
    async userInitRequestAsync(toUserID) {
        return await until(this, "userInitResponse",
            () => this.sendMessageTo(toUserID, "userInitRequest"),
            (evt) => evt.id === toUserID
                && isGoodNumber(evt.px)
                && isGoodNumber(evt.py)
                && isGoodNumber(evt.pz),
            1000);
    }

    /**
     * @param {string} toUserID
     * @param {import("../game/User").User} fromUserState
     */
    userInitResponse(toUserID, fromUserState) {
        this.sendMessageTo(toUserID, "userInitResponse", fromUserState);
    }

    /**
     * @param {import("../emoji/Emoji").Emoji} emoji
     **/
    set avatarEmoji(emoji) {
        for (let toUserID of this.userIDs()) {
            this.sendMessageTo(toUserID, "setAvatarEmoji", emoji);
        }
    }

    /**
     * @param {string} url
     **/
    set avatarURL(url) {
        for (let toUserID of this.userIDs()) {
            this.sendMessageTo(toUserID, "avatarChanged", { url });
        }
    }

    /**
     * @param {import("../emoji/Emoji").Emoji} emoji
     **/
    emote(emoji) {
        for (let toUserID of this.userIDs()) {
            this.sendMessageTo(toUserID, "emote", emoji);
        }
    }
}

/**
 * 
 * @param {EventBase|EventTarget} target
 * @param {any} obj
 */
function addEventListeners(target, obj) {
    for (let evtName in obj) {
        let callback = obj[evtName];
        let opts = undefined;
        if (callback instanceof Array) {
            opts = callback[1];
            callback = callback[0];
        }

        target.addEventListener(evtName, callback, opts);
    }
}

/**
 * Translate a value out of a range.
 *
 * @param {number} v
 * @param {number} min
 * @param {number} max
 */

function unproject(v, min, max) {
    return v * (max - min) + min;
}

/**
 * Unicode-standardized pictograms.
 **/
class Emoji {
    /**
     * Creates a new Unicode-standardized pictograms.
     * @param {string} value - a Unicode sequence.
     * @param {string} desc - an English text description of the pictogram.
     */
    constructor(value, desc) {
        this.value = value;
        this.desc = desc;
    }

    /**
     * Determines of the provided Emoji or EmojiGroup is a subset of
     * this emoji.
     * @param {(Emoji|EmojiGroup)} e
     */
    contains(e) {
        return this.value.indexOf(e.value) >= 0;
    }
}

/**
 * Shorthand for `new Emoji`, which saves significantly on bundle size.
 * @param {string} v - a Unicode sequence.
 * @param {string} d - an English text description of the pictogram.
 * @param {any} [o=null] - an optional set of properties to set on the Emoji object.
 * @returns {Emoji}
 */
function e(v, d, o = null) {
    return Object.assign(new Emoji(v, d), o);
}

class EmojiGroup extends Emoji {
    /**
     * Groupings of Unicode-standardized pictograms.
     * @param {string} value - a Unicode sequence.
     * @param {string} desc - an English text description of the pictogram.
     * @param {Emoji[]} rest - Emojis in this group.
     */
    constructor(value, desc, ...rest) {
        super(value, desc);
        /** @type {Emoji[]} */
        this.alts = rest;
        /** @type {string} */
        this.width = null;
    }

    /**
     * Selects a random emoji out of the collection.
     * @returns {(Emoji|EmojiGroup)}
     **/
    random() {
        const idx = Math.floor(Math.random() * this.alts.length);
        if (idx < 0) {
            return null;
        }

        const selection = this.alts[idx];
        if (selection instanceof EmojiGroup) {
            return selection.random();
        }
        else {
            return selection;
        }
    }

    /**
     *
     * @param {(Emoji|EmojiGroup)} e
     */
    contains(e) {
        return super.contains(e)
            || this.alts.reduce((a, b) => a || b.contains(e), false);
    }
}


/**
 * Shorthand for `new EmojiGroup`, which saves significantly on bundle size.
 * @param {string} v - a Unicode sequence.
 * @param {string} d - an English text description of the pictogram.
 * @param {...(Emoji|EmojiGroup)} r - the emoji that are contained in this group.
 * @returns {EmojiGroup}
 */
function g(v, d, ...r) {
    return new EmojiGroup(v, d, ...r);
}

/**
 * A shorthand for `new EmojiGroup` that allows for setting optional properties
 * on the EmojiGroup object.
 * @param {string} v - a Unicode sequence.
 * @param {string} d - an English text description of the pictogram.
 * @param {any} o - a set of properties to set on the Emoji object.
 * @param {...(Emoji|import("./EmojiGroup").EmojiGroup)} r - the emoji that are contained in this group.
 * @returns {import("./EmojiGroup").EmojiGroup}
 */
function gg(v, d, o, ...r) {
    return Object.assign(
        g(
            v,
            d,
            ...Object
                .values(o)
                .filter(v => v instanceof Emoji),
            ...r),
        o);
}

const textStyle = e("\u{FE0E}", "Variation Selector-15: text style");
const emojiStyle = e("\u{FE0F}", "Variation Selector-16: emoji style");
const zeroWidthJoiner = e("\u{200D}", "Zero Width Joiner");
const combiningEnclosingCircleBackslash = e("\u{20E3}", "Combining Enclosing Circle Backslash");
const combiningEnclosingKeycap = e("\u{20E3}", "Combining Enclosing Keycap");

const female = e("\u{2640}\u{FE0F}", "Female");
const male = e("\u{2642}\u{FE0F}", "Male");
const skinL = e("\u{1F3FB}", "Light Skin Tone");
const skinML = e("\u{1F3FC}", "Medium-Light Skin Tone");
const skinM = e("\u{1F3FD}", "Medium Skin Tone");
const skinMD = e("\u{1F3FE}", "Medium-Dark Skin Tone");
const skinD = e("\u{1F3FF}", "Dark Skin Tone");
const hairRed = e("\u{1F9B0}", "Red Hair");
const hairCurly = e("\u{1F9B1}", "Curly Hair");
const hairWhite = e("\u{1F9B3}", "White Hair");
const hairBald = e("\u{1F9B2}", "Bald");

function combo(a, b) {
    if (a instanceof Array) {
        return a.map(c => combo(c, b));
    }
    else if (a instanceof EmojiGroup) {
        const { value, desc } = combo(e(a.value, a.desc), b);
        return g(value, desc, ...combo(a.alts, b));
    }
    else if (b instanceof Array) {
        return b.map(c => combo(a, c));
    }
    else {
        return e(a.value + b.value, a.desc + ": " + b.desc);
    }
}

function join(a, b) {
    if (a instanceof Array) {
        return a.map(c => join(c, b));
    }
    else if (a instanceof EmojiGroup) {
        const { value, desc } = join(e(a.value, a.desc), b);
        return g(value, desc, ...join(a.alts, b));
    }
    else if (b instanceof Array) {
        return b.map(c => join(a, c));
    }
    else {
        return e(a.value + zeroWidthJoiner.value + b.value, a.desc + ": " + b.desc);
    }
}

/**
 * Check to see if a given Emoji walks on water.
 * @param {Emoji} e
 */
function isSurfer(e) {
    return surfers.contains(e)
        || rowers.contains(e)
        || swimmers.contains(e)
        || merpeople.contains(e);
}

function skin(v, d, ...rest) {
    const person = e(v, d),
        light = combo(person, skinL),
        mediumLight = combo(person, skinML),
        medium = combo(person, skinM),
        mediumDark = combo(person, skinMD),
        dark = combo(person, skinD);
    return gg(person.value, person.desc, {
        default: person,
        light,
        mediumLight,
        medium,
        mediumDark,
        dark
    }, ...rest);
}

function sex(person) {
    const man = join(person, male),
        woman = join(person, female);

    return gg(person.value, person.desc, {
        default: person,
        man,
        woman
    });
}

function skinAndSex(v, d) {
    return sex(skin(v, d));
}

function skinAndHair(v, d, ...rest) {
    const people = skin(v, d),
        red = join(people, hairRed),
        curly = join(people, hairCurly),
        white = join(people, hairWhite),
        bald = join(people, hairBald);
    return gg(people.value, people.desc, {
        default: people,
        red,
        curly,
        white,
        bald
    }, ...rest);
}

function sym(symbol, name) {
    const j = e(symbol.value, name),
        men = join(man.default, j),
        women = join(woman.default, j);
    return gg(symbol.value, symbol.desc, {
        symbol,
        men,
        women
    });
}

const frowners = skinAndSex("\u{1F64D}", "Frowning");
const pouters = skinAndSex("\u{1F64E}", "Pouting");
const gesturingNo = skinAndSex("\u{1F645}", "Gesturing NO");
const gesturingOK = skinAndSex("\u{1F646}", "Gesturing OK");
const tippingHand = skinAndSex("\u{1F481}", "Tipping Hand");
const raisingHand = skinAndSex("\u{1F64B}", "Raising Hand");
const bowing = skinAndSex("\u{1F647}", "Bowing");
const facePalming = skinAndSex("\u{1F926}", "Facepalming");
const shrugging = skinAndSex("\u{1F937}", "Shrugging");
const cantHear = skinAndSex("\u{1F9CF}", "Can't Hear");
const gettingMassage = skinAndSex("\u{1F486}", "Getting Massage");
const gettingHaircut = skinAndSex("\u{1F487}", "Getting Haircut");

const constructionWorkers = skinAndSex("\u{1F477}", "Construction Worker");
const guards = skinAndSex("\u{1F482}", "Guard");
const spies = skinAndSex("\u{1F575}", "Spy");
const police = skinAndSex("\u{1F46E}", "Police");
const wearingTurban = skinAndSex("\u{1F473}", "Wearing Turban");
const superheroes = skinAndSex("\u{1F9B8}", "Superhero");
const supervillains = skinAndSex("\u{1F9B9}", "Supervillain");
const mages = skinAndSex("\u{1F9D9}", "Mage");
const fairies = skinAndSex("\u{1F9DA}", "Fairy");
const vampires = skinAndSex("\u{1F9DB}", "Vampire");
const merpeople = skinAndSex("\u{1F9DC}", "Merperson");
const elves = skinAndSex("\u{1F9DD}", "Elf");
const walking = skinAndSex("\u{1F6B6}", "Walking");
const standing = skinAndSex("\u{1F9CD}", "Standing");
const kneeling = skinAndSex("\u{1F9CE}", "Kneeling");
const runners = skinAndSex("\u{1F3C3}", "Running");

const gestures$1 = g(
    "Gestures", "Gestures",
    frowners,
    pouters,
    gesturingNo,
    gesturingOK,
    tippingHand,
    raisingHand,
    bowing,
    facePalming,
    shrugging,
    cantHear,
    gettingMassage,
    gettingHaircut);


const baby = skin("\u{1F476}", "Baby");
const child = skin("\u{1F9D2}", "Child");
const boy = skin("\u{1F466}", "Boy");
const girl = skin("\u{1F467}", "Girl");
const children = gg(child.value, child.desc, {
    default: child,
    male: boy,
    female: girl
});


const blondes = skinAndSex("\u{1F471}", "Blond Person");
const person = skin("\u{1F9D1}", "Person", blondes.default, wearingTurban.default);

const beardedMan = skin("\u{1F9D4}", "Bearded Man");
const manInSuitLevitating = e("\u{1F574}\u{FE0F}", "Man in Suit, Levitating");
const manWithChineseCap = skin("\u{1F472}", "Man With Chinese Cap");
const manInTuxedo = skin("\u{1F935}", "Man in Tuxedo");
const man = skinAndHair("\u{1F468}", "Man",
    blondes.man,
    beardedMan,
    manInSuitLevitating,
    manWithChineseCap,
    wearingTurban.man,
    manInTuxedo);

const pregnantWoman = skin("\u{1F930}", "Pregnant Woman");
const breastFeeding = skin("\u{1F931}", "Breast-Feeding");
const womanWithHeadscarf = skin("\u{1F9D5}", "Woman With Headscarf");
const brideWithVeil = skin("\u{1F470}", "Bride With Veil");
const woman = skinAndHair("\u{1F469}", "Woman",
    blondes.woman,
    pregnantWoman,
    breastFeeding,
    womanWithHeadscarf,
    wearingTurban.woman,
    brideWithVeil);
const adults = gg(
    person.value, "Adult", {
    default: person,
    male: man,
    female: woman
});

const olderPerson = skin("\u{1F9D3}", "Older Person");
const oldMan = skin("\u{1F474}", "Old Man");
const oldWoman = skin("\u{1F475}", "Old Woman");
const elderly = gg(
    olderPerson.value, olderPerson.desc, {
    default: olderPerson,
    male: oldMan,
    female: oldWoman
});

const medical = e("\u{2695}\u{FE0F}", "Medical");
const healthCareWorkers = sym(medical, "Health Care");

const graduationCap = e("\u{1F393}", "Graduation Cap");
const students = sym(graduationCap, "Student");

const school = e("\u{1F3EB}", "School");
const teachers = sym(school, "Teacher");

const balanceScale = e("\u{2696}\u{FE0F}", "Balance Scale");
const judges = sym(balanceScale, "Judge");

const sheafOfRice = e("\u{1F33E}", "Sheaf of Rice");
const farmers = sym(sheafOfRice, "Farmer");

const cooking = e("\u{1F373}", "Cooking");
const cooks = sym(cooking, "Cook");

const wrench = e("\u{1F527}", "Wrench");
const mechanics = sym(wrench, "Mechanic");

const factory = e("\u{1F3ED}", "Factory");
const factoryWorkers = sym(factory, "Factory Worker");

const briefcase = e("\u{1F4BC}", "Briefcase");
const officeWorkers = sym(briefcase, "Office Worker");

const fireEngine = e("\u{1F692}", "Fire Engine");
const fireFighters = sym(fireEngine, "Fire Fighter");

const rocket = e("\u{1F680}", "Rocket");
const astronauts = sym(rocket, "Astronaut");

const airplane = e("\u{2708}\u{FE0F}", "Airplane");
const pilots = sym(airplane, "Pilot");

const artistPalette = e("\u{1F3A8}", "Artist Palette");
const artists = sym(artistPalette, "Artist");

const microphone = e("\u{1F3A4}", "Microphone");
const singers = sym(microphone, "Singer");

const laptop = e("\u{1F4BB}", "Laptop");
const technologists = sym(laptop, "Technologist");

const microscope = e("\u{1F52C}", "Microscope");
const scientists = sym(microscope, "Scientist");

const crown = e("\u{1F451}", "Crown");
const prince = skin("\u{1F934}", "Prince");
const princess = skin("\u{1F478}", "Princess");
const royalty = gg(
    crown.value, crown.desc, {
    symbol: crown,
    male: prince,
    female: princess
});

const roles = gg(
    "Roles", "Depictions of people working", {
    healthCareWorkers,
    students,
    teachers,
    judges,
    farmers,
    cooks,
    mechanics,
    factoryWorkers,
    officeWorkers,
    scientists,
    technologists,
    singers,
    artists,
    pilots,
    astronauts,
    fireFighters,
    spies,
    guards,
    constructionWorkers,
    royalty
});

const cherub = skin("\u{1F47C}", "Cherub");
const santaClaus = skin("\u{1F385}", "Santa Claus");
const mrsClaus = skin("\u{1F936}", "Mrs. Claus");

const genies = sex(e("\u{1F9DE}", "Genie"));
const zombies = sex(e("\u{1F9DF}", "Zombie"));

const fantasy = gg(
    "Fantasy", "Depictions of fantasy characters", {
    cherub,
    santaClaus,
    mrsClaus,
    superheroes,
    supervillains,
    mages,
    fairies,
    vampires,
    merpeople,
    elves,
    genies,
    zombies
});

const whiteCane = e("\u{1F9AF}", "Probing Cane");
const withProbingCane = sym(whiteCane, "Probing");

const motorizedWheelchair = e("\u{1F9BC}", "Motorized Wheelchair");
const inMotorizedWheelchair = sym(motorizedWheelchair, "In Motorized Wheelchair");

const manualWheelchair = e("\u{1F9BD}", "Manual Wheelchair");
const inManualWheelchair = sym(manualWheelchair, "In Manual Wheelchair");


const manDancing = skin("\u{1F57A}", "Man Dancing");
const womanDancing = skin("\u{1F483}", "Woman Dancing");
const dancers = gg(
    manDancing.value, "Dancing", {
    male: manDancing,
    female: womanDancing
});

const jugglers = skinAndSex("\u{1F939}", "Juggler");

const climbers = skinAndSex("\u{1F9D7}", "Climber");
const fencer = e("\u{1F93A}", "Fencer");
const jockeys = skin("\u{1F3C7}", "Jockey");
const skier = e("\u{26F7}\u{FE0F}", "Skier");
const snowboarders = skin("\u{1F3C2}", "Snowboarder");
const golfers = skinAndSex("\u{1F3CC}\u{FE0F}", "Golfer");
const surfers = skinAndSex("\u{1F3C4}", "Surfing");
const rowers = skinAndSex("\u{1F6A3}", "Rowing Boat");
const swimmers = skinAndSex("\u{1F3CA}", "Swimming");
const basketballers = skinAndSex("\u{26F9}\u{FE0F}", "Basket Baller");
const weightLifters = skinAndSex("\u{1F3CB}\u{FE0F}", "Weight Lifter");
const bikers = skinAndSex("\u{1F6B4}", "Biker");
const mountainBikers = skinAndSex("\u{1F6B5}", "Mountain Biker");
const cartwheelers = skinAndSex("\u{1F938}", "Cartwheeler");
const wrestlers = sex(e("\u{1F93C}", "Wrestler"));
const waterPoloers = skinAndSex("\u{1F93D}", "Water Polo Player");
const handBallers = skinAndSex("\u{1F93E}", "Hand Baller");

const inMotion = gg(
    "In Motion", "Depictions of people in motion", {
    walking,
    standing,
    kneeling,
    withProbingCane,
    inMotorizedWheelchair,
    inManualWheelchair,
    dancers,
    jugglers,
    climbers,
    fencer,
    jockeys,
    skier,
    snowboarders,
    golfers,
    surfers,
    rowers,
    swimmers,
    runners,
    basketballers,
    weightLifters,
    bikers,
    mountainBikers,
    cartwheelers,
    wrestlers,
    waterPoloers,
    handBallers
});

const inLotusPosition = skinAndSex("\u{1F9D8}", "In Lotus Position");
const inBath = skin("\u{1F6C0}", "In Bath");
const inBed = skin("\u{1F6CC}", "In Bed");
const inSauna = skinAndSex("\u{1F9D6}", "In Sauna");
const resting = gg(
    "Resting", "Depictions of people at rest", {
    inLotusPosition,
    inBath,
    inBed,
    inSauna
});

const babies = g(baby.value, baby.desc, baby, cherub);
const people = gg(
    "People", "People", {
    babies,
    children,
    adults,
    elderly
});

const allPeople = gg(
    "All People", "All People", {
    people,
    gestures: gestures$1,
    inMotion,
    resting,
    roles,
    fantasy
});

const ogre = e("\u{1F479}", "Ogre");
const goblin = e("\u{1F47A}", "Goblin");
const ghost = e("\u{1F47B}", "Ghost");
const alien = e("\u{1F47D}", "Alien");
const alienMonster = e("\u{1F47E}", "Alien Monster");
const angryFaceWithHorns = e("\u{1F47F}", "Angry Face with Horns");
const skull = e("\u{1F480}", "Skull");
const pileOfPoo = e("\u{1F4A9}", "Pile of Poo");
const grinningFace = e("\u{1F600}", "Grinning Face");
const beamingFaceWithSmilingEyes = e("\u{1F601}", "Beaming Face with Smiling Eyes");
const faceWithTearsOfJoy = e("\u{1F602}", "Face with Tears of Joy");
const grinningFaceWithBigEyes = e("\u{1F603}", "Grinning Face with Big Eyes");
const grinningFaceWithSmilingEyes = e("\u{1F604}", "Grinning Face with Smiling Eyes");
const grinningFaceWithSweat = e("\u{1F605}", "Grinning Face with Sweat");
const grinningSquitingFace = e("\u{1F606}", "Grinning Squinting Face");
const smillingFaceWithHalo = e("\u{1F607}", "Smiling Face with Halo");
const smilingFaceWithHorns = e("\u{1F608}", "Smiling Face with Horns");
const winkingFace = e("\u{1F609}", "Winking Face");
const smilingFaceWithSmilingEyes = e("\u{1F60A}", "Smiling Face with Smiling Eyes");
const faceSavoringFood = e("\u{1F60B}", "Face Savoring Food");
const relievedFace = e("\u{1F60C}", "Relieved Face");
const smilingFaceWithHeartEyes = e("\u{1F60D}", "Smiling Face with Heart-Eyes");
const smilingFaceWithSunglasses = e("\u{1F60E}", "Smiling Face with Sunglasses");
const smirkingFace = e("\u{1F60F}", "Smirking Face");
const neutralFace = e("\u{1F610}", "Neutral Face");
const expressionlessFace = e("\u{1F611}", "Expressionless Face");
const unamusedFace = e("\u{1F612}", "Unamused Face");
const downcastFaceWithSweat = e("\u{1F613}", "Downcast Face with Sweat");
const pensiveFace = e("\u{1F614}", "Pensive Face");
const confusedFace = e("\u{1F615}", "Confused Face");
const confoundedFace = e("\u{1F616}", "Confounded Face");
const kissingFace = e("\u{1F617}", "Kissing Face");
const faceBlowingAKiss = e("\u{1F618}", "Face Blowing a Kiss");
const kissingFaceWithSmilingEyes = e("\u{1F619}", "Kissing Face with Smiling Eyes");
const kissingFaceWithClosedEyes = e("\u{1F61A}", "Kissing Face with Closed Eyes");
const faceWithTongue = e("\u{1F61B}", "Face with Tongue");
const winkingFaceWithTongue = e("\u{1F61C}", "Winking Face with Tongue");
const squintingFaceWithTongue = e("\u{1F61D}", "Squinting Face with Tongue");
const disappointedFace = e("\u{1F61E}", "Disappointed Face");
const worriedFace = e("\u{1F61F}", "Worried Face");
const angryFace = e("\u{1F620}", "Angry Face");
const poutingFace = e("\u{1F621}", "Pouting Face");
const cryingFace = e("\u{1F622}", "Crying Face");
const perseveringFace = e("\u{1F623}", "Persevering Face");
const faceWithSteamFromNose = e("\u{1F624}", "Face with Steam From Nose");
const sadButRelievedFace = e("\u{1F625}", "Sad but Relieved Face");
const frowningFaceWithOpenMouth = e("\u{1F626}", "Frowning Face with Open Mouth");
const anguishedFace = e("\u{1F627}", "Anguished Face");
const fearfulFace = e("\u{1F628}", "Fearful Face");
const wearyFace = e("\u{1F629}", "Weary Face");
const sleepyFace = e("\u{1F62A}", "Sleepy Face");
const tiredFace = e("\u{1F62B}", "Tired Face");
const grimacingFace = e("\u{1F62C}", "Grimacing Face");
const loudlyCryingFace = e("\u{1F62D}", "Loudly Crying Face");
const faceWithOpenMouth = e("\u{1F62E}", "Face with Open Mouth");
const hushedFace = e("\u{1F62F}", "Hushed Face");
const anxiousFaceWithSweat = e("\u{1F630}", "Anxious Face with Sweat");
const faceScreamingInFear = e("\u{1F631}", "Face Screaming in Fear");
const astonishedFace = e("\u{1F632}", "Astonished Face");
const flushedFace = e("\u{1F633}", "Flushed Face");
const sleepingFace = e("\u{1F634}", "Sleeping Face");
const dizzyFace = e("\u{1F635}", "Dizzy Face");
const faceWithoutMouth = e("\u{1F636}", "Face Without Mouth");
const faceWithMedicalMask = e("\u{1F637}", "Face with Medical Mask");
const grinningCatWithSmilingEyes = e("\u{1F638}", "Grinning Cat with Smiling Eyes");
const catWithTearsOfJoy = e("\u{1F639}", "Cat with Tears of Joy");
const grinningCat = e("\u{1F63A}", "Grinning Cat");
const smilingCatWithHeartEyes = e("\u{1F63B}", "Smiling Cat with Heart-Eyes");
const catWithWrySmile = e("\u{1F63C}", "Cat with Wry Smile");
const kissingCat = e("\u{1F63D}", "Kissing Cat");
const poutingCat = e("\u{1F63E}", "Pouting Cat");
const cryingCat = e("\u{1F63F}", "Crying Cat");
const wearyCat = e("\u{1F640}", "Weary Cat");
const slightlyFrowningFace = e("\u{1F641}", "Slightly Frowning Face");
const slightlySmilingFace = e("\u{1F642}", "Slightly Smiling Face");
const updisdeDownFace = e("\u{1F643}", "Upside-Down Face");
const faceWithRollingEyes = e("\u{1F644}", "Face with Rolling Eyes");
const seeNoEvilMonkey = e("\u{1F648}", "See-No-Evil Monkey");
const hearNoEvilMonkey = e("\u{1F649}", "Hear-No-Evil Monkey");
const speakNoEvilMonkey = e("\u{1F64A}", "Speak-No-Evil Monkey");
const zipperMouthFace = e("\u{1F910}", "Zipper-Mouth Face");
const moneyMouthFace = e("\u{1F911}", "Money-Mouth Face");
const faceWithThermometer = e("\u{1F912}", "Face with Thermometer");
const nerdFace = e("\u{1F913}", "Nerd Face");
const thinkingFace = e("\u{1F914}", "Thinking Face");
const faceWithHeadBandage = e("\u{1F915}", "Face with Head-Bandage");
const robot = e("\u{1F916}", "Robot");
const huggingFace = e("\u{1F917}", "Hugging Face");
const cowboyHatFace = e("\u{1F920}", "Cowboy Hat Face");
const clownFace = e("\u{1F921}", "Clown Face");
const nauseatedFace = e("\u{1F922}", "Nauseated Face");
const rollingOnTheFloorLaughing = e("\u{1F923}", "Rolling on the Floor Laughing");
const droolingFace = e("\u{1F924}", "Drooling Face");
const lyingFace = e("\u{1F925}", "Lying Face");
const sneezingFace = e("\u{1F927}", "Sneezing Face");
const faceWithRaisedEyebrow = e("\u{1F928}", "Face with Raised Eyebrow");
const starStruck = e("\u{1F929}", "Star-Struck");
const zanyFace = e("\u{1F92A}", "Zany Face");
const shushingFace = e("\u{1F92B}", "Shushing Face");
const faceWithSymbolsOnMouth = e("\u{1F92C}", "Face with Symbols on Mouth");
const faceWithHandOverMouth = e("\u{1F92D}", "Face with Hand Over Mouth");
const faceVomitting = e("\u{1F92E}", "Face Vomiting");
const explodingHead = e("\u{1F92F}", "Exploding Head");
const smilingFaceWithHearts = e("\u{1F970}", "Smiling Face with Hearts");
const yawningFace = e("\u{1F971}", "Yawning Face");
//export const smilingFaceWithTear = e("\u{1F972}", "Smiling Face with Tear");
const partyingFace = e("\u{1F973}", "Partying Face");
const woozyFace = e("\u{1F974}", "Woozy Face");
const hotFace = e("\u{1F975}", "Hot Face");
const coldFace = e("\u{1F976}", "Cold Face");
//export const disguisedFace = e("\u{1F978}", "Disguised Face");
const pleadingFace = e("\u{1F97A}", "Pleading Face");
const faceWithMonocle = e("\u{1F9D0}", "Face with Monocle");
const skullAndCrossbones = e("\u{2620}\u{FE0F}", "Skull and Crossbones");
const frowningFace = e("\u{2639}\u{FE0F}", "Frowning Face");
const smilingFace = e("\u{263A}\u{FE0F}", "Smiling Face");
const speakingHead = e("\u{1F5E3}\u{FE0F}", "Speaking Head");
const bust = e("\u{1F464}", "Bust in Silhouette");
const faces = gg(
    "Faces", "Round emoji faces", {
    ogre,
    goblin,
    ghost,
    alien,
    alienMonster,
    angryFaceWithHorns,
    skull,
    pileOfPoo,
    grinningFace,
    beamingFaceWithSmilingEyes,
    faceWithTearsOfJoy,
    grinningFaceWithBigEyes,
    grinningFaceWithSmilingEyes,
    grinningFaceWithSweat,
    grinningSquitingFace,
    smillingFaceWithHalo,
    smilingFaceWithHorns,
    winkingFace,
    smilingFaceWithSmilingEyes,
    faceSavoringFood,
    relievedFace,
    smilingFaceWithHeartEyes,
    smilingFaceWithSunglasses,
    smirkingFace,
    neutralFace,
    expressionlessFace,
    unamusedFace,
    downcastFaceWithSweat,
    pensiveFace,
    confusedFace,
    confoundedFace,
    kissingFace,
    faceBlowingAKiss,
    kissingFaceWithSmilingEyes,
    kissingFaceWithClosedEyes,
    faceWithTongue,
    winkingFaceWithTongue,
    squintingFaceWithTongue,
    disappointedFace,
    worriedFace,
    angryFace,
    poutingFace,
    cryingFace,
    perseveringFace,
    faceWithSteamFromNose,
    sadButRelievedFace,
    frowningFaceWithOpenMouth,
    anguishedFace,
    fearfulFace,
    wearyFace,
    sleepyFace,
    tiredFace,
    grimacingFace,
    loudlyCryingFace,
    faceWithOpenMouth,
    hushedFace,
    anxiousFaceWithSweat,
    faceScreamingInFear,
    astonishedFace,
    flushedFace,
    sleepingFace,
    dizzyFace,
    faceWithoutMouth,
    faceWithMedicalMask,
    grinningCatWithSmilingEyes,
    catWithTearsOfJoy,
    grinningCat,
    smilingCatWithHeartEyes,
    catWithWrySmile,
    kissingCat,
    poutingCat,
    cryingCat,
    wearyCat,
    slightlyFrowningFace,
    slightlySmilingFace,
    updisdeDownFace,
    faceWithRollingEyes,
    seeNoEvilMonkey,
    hearNoEvilMonkey,
    speakNoEvilMonkey,
    zipperMouthFace,
    moneyMouthFace,
    faceWithThermometer,
    nerdFace,
    thinkingFace,
    faceWithHeadBandage,
    robot,
    huggingFace,
    cowboyHatFace,
    clownFace,
    nauseatedFace,
    rollingOnTheFloorLaughing,
    droolingFace,
    lyingFace,
    sneezingFace,
    faceWithRaisedEyebrow,
    starStruck,
    zanyFace,
    shushingFace,
    faceWithSymbolsOnMouth,
    faceWithHandOverMouth,
    faceVomitting,
    explodingHead,
    smilingFaceWithHearts,
    yawningFace,
    //smilingFaceWithTear,
    partyingFace,
    woozyFace,
    hotFace,
    coldFace,
    //disguisedFace,
    pleadingFace,
    faceWithMonocle,
    skullAndCrossbones,
    frowningFace,
    smilingFace,
    speakingHead,
    bust,
});

const kissMark = e("\u{1F48B}", "Kiss Mark");
const loveLetter = e("\u{1F48C}", "Love Letter");
const beatingHeart = e("\u{1F493}", "Beating Heart");
const brokenHeart = e("\u{1F494}", "Broken Heart");
const twoHearts = e("\u{1F495}", "Two Hearts");
const sparklingHeart = e("\u{1F496}", "Sparkling Heart");
const growingHeart = e("\u{1F497}", "Growing Heart");
const heartWithArrow = e("\u{1F498}", "Heart with Arrow");
const blueHeart = e("\u{1F499}", "Blue Heart");
const greenHeart = e("\u{1F49A}", "Green Heart");
const yellowHeart = e("\u{1F49B}", "Yellow Heart");
const purpleHeart = e("\u{1F49C}", "Purple Heart");
const heartWithRibbon = e("\u{1F49D}", "Heart with Ribbon");
const revolvingHearts = e("\u{1F49E}", "Revolving Hearts");
const heartDecoration = e("\u{1F49F}", "Heart Decoration");
const blackHeart = e("\u{1F5A4}", "Black Heart");
const whiteHeart = e("\u{1F90D}", "White Heart");
const brownHeart = e("\u{1F90E}", "Brown Heart");
const orangeHeart = e("\u{1F9E1}", "Orange Heart");
const heartExclamation = e("\u{2763}\u{FE0F}", "Heart Exclamation");
const redHeart = e("\u{2764}\u{FE0F}", "Red Heart");
const love = gg(
    "Love", "Hearts and kisses", {
    kissMark,
    loveLetter,
    beatingHeart,
    brokenHeart,
    twoHearts,
    sparklingHeart,
    growingHeart,
    heartWithArrow,
    blueHeart,
    greenHeart,
    yellowHeart,
    purpleHeart,
    heartWithRibbon,
    revolvingHearts,
    heartDecoration,
    blackHeart,
    whiteHeart,
    brownHeart,
    orangeHeart,
    heartExclamation,
    redHeart,
});

const angerSymbol = e("\u{1F4A2}", "Anger Symbol");
const bomb = e("\u{1F4A3}", "Bomb");
const zzz = e("\u{1F4A4}", "Zzz");
const collision = e("\u{1F4A5}", "Collision");
const sweatDroplets = e("\u{1F4A6}", "Sweat Droplets");
const dashingAway = e("\u{1F4A8}", "Dashing Away");
const dizzy = e("\u{1F4AB}", "Dizzy");
const speechBalloon = e("\u{1F4AC}", "Speech Balloon");
const thoughtBalloon = e("\u{1F4AD}", "Thought Balloon");
const hundredPoints = e("\u{1F4AF}", "Hundred Points");
const hole = e("\u{1F573}\u{FE0F}", "Hole");
const leftSpeechBubble = e("\u{1F5E8}\u{FE0F}", "Left Speech Bubble");
const rightSpeechBubble = e("\u{1F5E9}\u{FE0F}", "Right Speech Bubble");
const conversationBubbles2 = e("\u{1F5EA}\u{FE0F}", "Conversation Bubbles 2");
const conversationBubbles3 = e("\u{1F5EB}\u{FE0F}", "Conversation Bubbles 3");
const leftThoughtBubble = e("\u{1F5EC}\u{FE0F}", "Left Thought Bubble");
const rightThoughtBubble = e("\u{1F5ED}\u{FE0F}", "Right Thought Bubble");
const leftAngerBubble = e("\u{1F5EE}\u{FE0F}", "Left Anger Bubble");
const rightAngerBubble = e("\u{1F5EF}\u{FE0F}", "Right Anger Bubble");
const angerBubble = e("\u{1F5F0}\u{FE0F}", "Anger Bubble");
const angerBubbleLightningBolt = e("\u{1F5F1}\u{FE0F}", "Anger Bubble Lightning");
const lightningBolt = e("\u{1F5F2}\u{FE0F}", "Lightning Bolt");

const cartoon = g(
    "Cartoon", "Cartoon symbols",
    angerSymbol,
    bomb,
    zzz,
    collision,
    sweatDroplets,
    dashingAway,
    dizzy,
    speechBalloon,
    thoughtBalloon,
    hundredPoints,
    hole,
    leftSpeechBubble,
    rightSpeechBubble,
    conversationBubbles2,
    conversationBubbles3,
    leftThoughtBubble,
    rightThoughtBubble,
    leftAngerBubble,
    rightAngerBubble,
    angerBubble,
    angerBubbleLightningBolt,
    lightningBolt);

const backhandIndexPointingUp = e("\u{1F446}", "Backhand Index Pointing Up");
const backhandIndexPointingDown = e("\u{1F447}", "Backhand Index Pointing Down");
const backhandIndexPointingLeft = e("\u{1F448}", "Backhand Index Pointing Left");
const backhandIndexPointingRight = e("\u{1F449}", "Backhand Index Pointing Right");
const oncomingFist = e("\u{1F44A}", "Oncoming Fist");
const wavingHand = e("\u{1F44B}", "Waving Hand");
const okHand = e("\u{1F58F}", "OK Hand");
const thumbsUp = e("\u{1F44D}", "Thumbs Up");
const thumbsDown = e("\u{1F44E}", "Thumbs Down");
const clappingHands = e("\u{1F44F}", "Clapping Hands");
const openHands = e("\u{1F450}", "Open Hands");
const nailPolish = e("\u{1F485}", "Nail Polish");
const handsWithFingersSplayed = e("\u{1F590}\u{FE0F}", "Hand with Fingers Splayed");
const handsWithFingersSplayed2 = e("\u{1F591}\u{FE0F}", "Hand with Fingers Splayed 2");
const thumbsUp2 = e("\u{1F592}", "Thumbs Up 2");
const thumbsDown2 = e("\u{1F593}", "Thumbs Down 2");
const peaceFingers = e("\u{1F594}", "Peace Fingers");
const middleFinger = e("\u{1F595}", "Middle Finger");
const vulcanSalute = e("\u{1F596}", "Vulcan Salute");
const handPointingDown = e("\u{1F597}", "Hand Pointing Down");
const handPointingLeft = e("\u{1F598}", "Hand Pointing Left");
const handPointingRight = e("\u{1F599}", "Hand Pointing Right");
const handPointingLeft2 = e("\u{1F59A}", "Hand Pointing Left 2");
const handPointingRight2 = e("\u{1F59B}", "Hand Pointing Right 2");
const indexPointingLeft = e("\u{1F59C}", "Index Pointing Left");
const indexPointingRight = e("\u{1F59D}", "Index Pointing Right");
const indexPointingUp = e("\u{1F59E}", "Index Pointing Up");
const indexPointingDown = e("\u{1F59F}", "Index Pointing Down");
const indexPointingUp2 = e("\u{1F5A0}", "Index Pointing Up 2");
const indexPointingDown2 = e("\u{1F5A1}", "Index Pointing Down 2");
const indexPointingUp3 = e("\u{1F5A2}", "Index Pointing Up 3");
const indexPointingDown3 = e("\u{1F5A3}", "Index Pointing Down 3");
const raisingHands = e("\u{1F64C}", "Raising Hands");
const foldedHands = e("\u{1F64F}", "Folded Hands");
//export const pinchedFingers = e("\u{1F90C}", "Pinched Fingers");
const pinchingHand = e("\u{1F90F}", "Pinching Hand");
const signOfTheHorns = e("\u{1F918}", "Sign of the Horns");
const callMeHand = e("\u{1F919}", "Call Me Hand");
const rasiedBackOfHand = e("\u{1F91A}", "Raised Back of Hand");
const leftFacingFist = e("\u{1F91B}", "Left-Facing Fist");
const rightFacingFist = e("\u{1F91C}", "Right-Facing Fist");
const handshake = e("\u{1F91D}", "Handshake");
const crossedFingers = e("\u{1F91E}", "Crossed Fingers");
const loveYouGesture = e("\u{1F91F}", "Love-You Gesture");
const palmsUpTogether = e("\u{1F932}", "Palms Up Together");
const indexPointingUp4 = e("\u{261D}\u{FE0F}", "Index Pointing Up 4");
const raisedFist = e("\u{270A}", "Raised Fist");
const raisedHand = e("\u{270B}", "Raised Hand");
const victoryHand = e("\u{270C}\u{FE0F}", "Victory Hand");
const writingHand = e("\u{270D}\u{FE0F}", "Writing Hand");
const hands = g(
    "Hands", "Hands pointing at things",
    backhandIndexPointingUp,
    backhandIndexPointingDown,
    backhandIndexPointingLeft,
    backhandIndexPointingRight,
    oncomingFist,
    wavingHand,
    okHand,
    thumbsUp,
    thumbsDown,
    clappingHands,
    openHands,
    nailPolish,
    handsWithFingersSplayed,
    handsWithFingersSplayed2,
    handsWithFingersSplayed2,
    thumbsUp2,
    thumbsDown2,
    peaceFingers,
    middleFinger,
    vulcanSalute,
    handPointingDown,
    handPointingLeft,
    handPointingRight,
    handPointingLeft2,
    handPointingRight2,
    indexPointingLeft,
    indexPointingRight,
    indexPointingUp,
    indexPointingDown,
    indexPointingUp2,
    indexPointingDown2,
    indexPointingUp3,
    indexPointingDown3,
    raisingHands,
    foldedHands,
    //pinchedFingers,
    pinchingHand,
    signOfTheHorns,
    callMeHand,
    rasiedBackOfHand,
    leftFacingFist,
    rightFacingFist,
    handshake,
    crossedFingers,
    loveYouGesture,
    palmsUpTogether,
    indexPointingUp4,
    raisedFist,
    raisedHand,
    victoryHand,
    writingHand);

const bodyParts = g(
    "Body Parts", "General body parts",
    e("\u{1F440}", "Eyes"),
    e("\u{1F441}\u{FE0F}", "Eye"),
    e("\u{1F441}\u{FE0F}\u{200D}\u{1F5E8}\u{FE0F}", "Eye in Speech Bubble"),
    e("\u{1F442}", "Ear"),
    e("\u{1F443}", "Nose"),
    e("\u{1F444}", "Mouth"),
    e("\u{1F445}", "Tongue"),
    e("\u{1F4AA}", "Flexed Biceps"),
    e("\u{1F933}", "Selfie"),
    e("\u{1F9B4}", "Bone"),
    e("\u{1F9B5}", "Leg"),
    e("\u{1F9B6}", "Foot"),
    e("\u{1F9B7}", "Tooth"),
    e("\u{1F9BB}", "Ear with Hearing Aid"),
    e("\u{1F9BE}", "Mechanical Arm"),
    e("\u{1F9BF}", "Mechanical Leg"),
    //e("\u{1FAC0}", "Anatomical Heart"),
    //e("\u{1FAC1}", "Lungs"),
    e("\u{1F9E0}", "Brain"));

const animals = g(
    "Animals", "Animals and insects",
    e("\u{1F400}", "Rat"),
    e("\u{1F401}", "Mouse"),
    e("\u{1F402}", "Ox"),
    e("\u{1F403}", "Water Buffalo"),
    e("\u{1F404}", "Cow"),
    e("\u{1F405}", "Tiger"),
    e("\u{1F406}", "Leopard"),
    e("\u{1F407}", "Rabbit"),
    e("\u{1F408}", "Cat"),
    //e("\u{1F408}\u{200D}\u{2B1B}", "Black Cat"),
    e("\u{1F409}", "Dragon"),
    e("\u{1F40A}", "Crocodile"),
    e("\u{1F40B}", "Whale"),
    e("\u{1F40C}", "Snail"),
    e("\u{1F40D}", "Snake"),
    e("\u{1F40E}", "Horse"),
    e("\u{1F40F}", "Ram"),
    e("\u{1F410}", "Goat"),
    e("\u{1F411}", "Ewe"),
    e("\u{1F412}", "Monkey"),
    e("\u{1F413}", "Rooster"),
    e("\u{1F414}", "Chicken"),
    e("\u{1F415}", "Dog"),
    e("\u{1F415}\u{200D}\u{1F9BA}", "Service Dog"),
    e("\u{1F416}", "Pig"),
    e("\u{1F417}", "Boar"),
    e("\u{1F418}", "Elephant"),
    e("\u{1F419}", "Octopus"),
    e("\u{1F41A}", "Spiral Shell"),
    e("\u{1F41B}", "Bug"),
    e("\u{1F41C}", "Ant"),
    e("\u{1F41D}", "Honeybee"),
    e("\u{1F41E}", "Lady Beetle"),
    e("\u{1F41F}", "Fish"),
    e("\u{1F420}", "Tropical Fish"),
    e("\u{1F421}", "Blowfish"),
    e("\u{1F422}", "Turtle"),
    e("\u{1F423}", "Hatching Chick"),
    e("\u{1F424}", "Baby Chick"),
    e("\u{1F425}", "Front-Facing Baby Chick"),
    e("\u{1F426}", "Bird"),
    e("\u{1F427}", "Penguin"),
    e("\u{1F428}", "Koala"),
    e("\u{1F429}", "Poodle"),
    e("\u{1F42A}", "Camel"),
    e("\u{1F42B}", "Two-Hump Camel"),
    e("\u{1F42C}", "Dolphin"),
    e("\u{1F42D}", "Mouse Face"),
    e("\u{1F42E}", "Cow Face"),
    e("\u{1F42F}", "Tiger Face"),
    e("\u{1F430}", "Rabbit Face"),
    e("\u{1F431}", "Cat Face"),
    e("\u{1F432}", "Dragon Face"),
    e("\u{1F433}", "Spouting Whale"),
    e("\u{1F434}", "Horse Face"),
    e("\u{1F435}", "Monkey Face"),
    e("\u{1F436}", "Dog Face"),
    e("\u{1F437}", "Pig Face"),
    e("\u{1F438}", "Frog"),
    e("\u{1F439}", "Hamster"),
    e("\u{1F43A}", "Wolf"),
    e("\u{1F43B}", "Bear"),
    e("\u{1F43B}\u{200D}\u{2744}\u{FE0F}", "Polar Bear"),
    e("\u{1F43C}", "Panda"),
    e("\u{1F43D}", "Pig Nose"),
    e("\u{1F43E}", "Paw Prints"),
    e("\u{1F43F}\u{FE0F}", "Chipmunk"),
    e("\u{1F54A}\u{FE0F}", "Dove"),
    e("\u{1F577}\u{FE0F}", "Spider"),
    e("\u{1F578}\u{FE0F}", "Spider Web"),
    e("\u{1F981}", "Lion"),
    e("\u{1F982}", "Scorpion"),
    e("\u{1F983}", "Turkey"),
    e("\u{1F984}", "Unicorn"),
    e("\u{1F985}", "Eagle"),
    e("\u{1F986}", "Duck"),
    e("\u{1F987}", "Bat"),
    e("\u{1F988}", "Shark"),
    e("\u{1F989}", "Owl"),
    e("\u{1F98A}", "Fox"),
    e("\u{1F98B}", "Butterfly"),
    e("\u{1F98C}", "Deer"),
    e("\u{1F98D}", "Gorilla"),
    e("\u{1F98E}", "Lizard"),
    e("\u{1F98F}", "Rhinoceros"),
    e("\u{1F992}", "Giraffe"),
    e("\u{1F993}", "Zebra"),
    e("\u{1F994}", "Hedgehog"),
    e("\u{1F995}", "Sauropod"),
    e("\u{1F996}", "T-Rex"),
    e("\u{1F997}", "Cricket"),
    e("\u{1F998}", "Kangaroo"),
    e("\u{1F999}", "Llama"),
    e("\u{1F99A}", "Peacock"),
    e("\u{1F99B}", "Hippopotamus"),
    e("\u{1F99C}", "Parrot"),
    e("\u{1F99D}", "Raccoon"),
    e("\u{1F99F}", "Mosquito"),
    e("\u{1F9A0}", "Microbe"),
    e("\u{1F9A1}", "Badger"),
    e("\u{1F9A2}", "Swan"),
    //e("\u{1F9A3}", "Mammoth"),
    //e("\u{1F9A4}", "Dodo"),
    e("\u{1F9A5}", "Sloth"),
    e("\u{1F9A6}", "Otter"),
    e("\u{1F9A7}", "Orangutan"),
    e("\u{1F9A8}", "Skunk"),
    e("\u{1F9A9}", "Flamingo"),
    //e("\u{1F9AB}", "Beaver"),
    //e("\u{1F9AC}", "Bison"),
    //e("\u{1F9AD}", "Seal"),
    //e("\u{1FAB0}", "Fly"),
    //e("\u{1FAB1}", "Worm"),
    //e("\u{1FAB2}", "Beetle"),
    //e("\u{1FAB3}", "Cockroach"),
    //e("\u{1FAB6}", "Feather"),
    e("\u{1F9AE}", "Guide Dog"));

const whiteFlower = e("\u{1F4AE}", "White Flower");
const plants = g(
    "Plants", "Flowers, trees, and things",
    e("\u{1F331}", "Seedling"),
    e("\u{1F332}", "Evergreen Tree"),
    e("\u{1F333}", "Deciduous Tree"),
    e("\u{1F334}", "Palm Tree"),
    e("\u{1F335}", "Cactus"),
    e("\u{1F337}", "Tulip"),
    e("\u{1F338}", "Cherry Blossom"),
    e("\u{1F339}", "Rose"),
    e("\u{1F33A}", "Hibiscus"),
    e("\u{1F33B}", "Sunflower"),
    e("\u{1F33C}", "Blossom"),
    sheafOfRice,
    e("\u{1F33F}", "Herb"),
    e("\u{1F340}", "Four Leaf Clover"),
    e("\u{1F341}", "Maple Leaf"),
    e("\u{1F342}", "Fallen Leaf"),
    e("\u{1F343}", "Leaf Fluttering in Wind"),
    e("\u{1F3F5}\u{FE0F}", "Rosette"),
    e("\u{1F490}", "Bouquet"),
    whiteFlower,
    e("\u{1F940}", "Wilted Flower"),
    //e("\u{1FAB4}", "Potted Plant"),
    e("\u{2618}\u{FE0F}", "Shamrock"));

const banana = e("\u{1F34C}", "Banana");
const food = g(
    "Food", "Food, drink, and utensils",
    e("\u{1F32D}", "Hot Dog"),
    e("\u{1F32E}", "Taco"),
    e("\u{1F32F}", "Burrito"),
    e("\u{1F330}", "Chestnut"),
    e("\u{1F336}\u{FE0F}", "Hot Pepper"),
    e("\u{1F33D}", "Ear of Corn"),
    e("\u{1F344}", "Mushroom"),
    e("\u{1F345}", "Tomato"),
    e("\u{1F346}", "Eggplant"),
    e("\u{1F347}", "Grapes"),
    e("\u{1F348}", "Melon"),
    e("\u{1F349}", "Watermelon"),
    e("\u{1F34A}", "Tangerine"),
    e("\u{1F34B}", "Lemon"),
    banana,
    e("\u{1F34D}", "Pineapple"),
    e("\u{1F34E}", "Red Apple"),
    e("\u{1F34F}", "Green Apple"),
    e("\u{1F350}", "Pear"),
    e("\u{1F351}", "Peach"),
    e("\u{1F352}", "Cherries"),
    e("\u{1F353}", "Strawberry"),
    e("\u{1F354}", "Hamburger"),
    e("\u{1F355}", "Pizza"),
    e("\u{1F356}", "Meat on Bone"),
    e("\u{1F357}", "Poultry Leg"),
    e("\u{1F358}", "Rice Cracker"),
    e("\u{1F359}", "Rice Ball"),
    e("\u{1F35A}", "Cooked Rice"),
    e("\u{1F35B}", "Curry Rice"),
    e("\u{1F35C}", "Steaming Bowl"),
    e("\u{1F35D}", "Spaghetti"),
    e("\u{1F35E}", "Bread"),
    e("\u{1F35F}", "French Fries"),
    e("\u{1F360}", "Roasted Sweet Potato"),
    e("\u{1F361}", "Dango"),
    e("\u{1F362}", "Oden"),
    e("\u{1F363}", "Sushi"),
    e("\u{1F364}", "Fried Shrimp"),
    e("\u{1F365}", "Fish Cake with Swirl"),
    e("\u{1F371}", "Bento Box"),
    e("\u{1F372}", "Pot of Food"),
    cooking,
    e("\u{1F37F}", "Popcorn"),
    e("\u{1F950}", "Croissant"),
    e("\u{1F951}", "Avocado"),
    e("\u{1F952}", "Cucumber"),
    e("\u{1F953}", "Bacon"),
    e("\u{1F954}", "Potato"),
    e("\u{1F955}", "Carrot"),
    e("\u{1F956}", "Baguette Bread"),
    e("\u{1F957}", "Green Salad"),
    e("\u{1F958}", "Shallow Pan of Food"),
    e("\u{1F959}", "Stuffed Flatbread"),
    e("\u{1F95A}", "Egg"),
    e("\u{1F95C}", "Peanuts"),
    e("\u{1F95D}", "Kiwi Fruit"),
    e("\u{1F95E}", "Pancakes"),
    e("\u{1F95F}", "Dumpling"),
    e("\u{1F960}", "Fortune Cookie"),
    e("\u{1F961}", "Takeout Box"),
    e("\u{1F963}", "Bowl with Spoon"),
    e("\u{1F965}", "Coconut"),
    e("\u{1F966}", "Broccoli"),
    e("\u{1F968}", "Pretzel"),
    e("\u{1F969}", "Cut of Meat"),
    e("\u{1F96A}", "Sandwich"),
    e("\u{1F96B}", "Canned Food"),
    e("\u{1F96C}", "Leafy Green"),
    e("\u{1F96D}", "Mango"),
    e("\u{1F96E}", "Moon Cake"),
    e("\u{1F96F}", "Bagel"),
    e("\u{1F980}", "Crab"),
    e("\u{1F990}", "Shrimp"),
    e("\u{1F991}", "Squid"),
    e("\u{1F99E}", "Lobster"),
    e("\u{1F9AA}", "Oyster"),
    e("\u{1F9C0}", "Cheese Wedge"),
    e("\u{1F9C2}", "Salt"),
    e("\u{1F9C4}", "Garlic"),
    e("\u{1F9C5}", "Onion"),
    e("\u{1F9C6}", "Falafel"),
    e("\u{1F9C7}", "Waffle"),
    e("\u{1F9C8}", "Butter"),
    //e("\u{1FAD0}", "Blueberries"),
    //e("\u{1FAD1}", "Bell Pepper"),
    //e("\u{1FAD2}", "Olive"),
    //e("\u{1FAD3}", "Flatbread"),
    //e("\u{1FAD4}", "Tamale"),
    //e("\u{1FAD5}", "Fondue"),
    e("\u{1F366}", "Soft Ice Cream"),
    e("\u{1F367}", "Shaved Ice"),
    e("\u{1F368}", "Ice Cream"),
    e("\u{1F369}", "Doughnut"),
    e("\u{1F36A}", "Cookie"),
    e("\u{1F36B}", "Chocolate Bar"),
    e("\u{1F36C}", "Candy"),
    e("\u{1F36D}", "Lollipop"),
    e("\u{1F36E}", "Custard"),
    e("\u{1F36F}", "Honey Pot"),
    e("\u{1F370}", "Shortcake"),
    e("\u{1F382}", "Birthday Cake"),
    e("\u{1F967}", "Pie"),
    e("\u{1F9C1}", "Cupcake"),
    e("\u{1F375}", "Teacup Without Handle"),
    e("\u{1F376}", "Sake"),
    e("\u{1F377}", "Wine Glass"),
    e("\u{1F378}", "Cocktail Glass"),
    e("\u{1F379}", "Tropical Drink"),
    e("\u{1F37A}", "Beer Mug"),
    e("\u{1F37B}", "Clinking Beer Mugs"),
    e("\u{1F37C}", "Baby Bottle"),
    e("\u{1F37E}", "Bottle with Popping Cork"),
    e("\u{1F942}", "Clinking Glasses"),
    e("\u{1F943}", "Tumbler Glass"),
    e("\u{1F95B}", "Glass of Milk"),
    e("\u{1F964}", "Cup with Straw"),
    e("\u{1F9C3}", "Beverage Box"),
    e("\u{1F9C9}", "Mate"),
    e("\u{1F9CA}", "Ice"),
    //e("\u{1F9CB}", "Bubble Tea"),
    //e("\u{1FAD6}", "Teapot"),
    e("\u{2615}", "Hot Beverage"),
    e("\u{1F374}", "Fork and Knife"),
    e("\u{1F37D}\u{FE0F}", "Fork and Knife with Plate"),
    e("\u{1F3FA}", "Amphora"),
    e("\u{1F52A}", "Kitchen Knife"),
    e("\u{1F944}", "Spoon"),
    e("\u{1F962}", "Chopsticks"));

const nations = g(
    "National Flags", "Flags of countries from around the world",
    e("\u{1F1E6}\u{1F1E8}", "Flag: Ascension Island"),
    e("\u{1F1E6}\u{1F1E9}", "Flag: Andorra"),
    e("\u{1F1E6}\u{1F1EA}", "Flag: United Arab Emirates"),
    e("\u{1F1E6}\u{1F1EB}", "Flag: Afghanistan"),
    e("\u{1F1E6}\u{1F1EC}", "Flag: Antigua & Barbuda"),
    e("\u{1F1E6}\u{1F1EE}", "Flag: Anguilla"),
    e("\u{1F1E6}\u{1F1F1}", "Flag: Albania"),
    e("\u{1F1E6}\u{1F1F2}", "Flag: Armenia"),
    e("\u{1F1E6}\u{1F1F4}", "Flag: Angola"),
    e("\u{1F1E6}\u{1F1F6}", "Flag: Antarctica"),
    e("\u{1F1E6}\u{1F1F7}", "Flag: Argentina"),
    e("\u{1F1E6}\u{1F1F8}", "Flag: American Samoa"),
    e("\u{1F1E6}\u{1F1F9}", "Flag: Austria"),
    e("\u{1F1E6}\u{1F1FA}", "Flag: Australia"),
    e("\u{1F1E6}\u{1F1FC}", "Flag: Aruba"),
    e("\u{1F1E6}\u{1F1FD}", "Flag: Åland Islands"),
    e("\u{1F1E6}\u{1F1FF}", "Flag: Azerbaijan"),
    e("\u{1F1E7}\u{1F1E6}", "Flag: Bosnia & Herzegovina"),
    e("\u{1F1E7}\u{1F1E7}", "Flag: Barbados"),
    e("\u{1F1E7}\u{1F1E9}", "Flag: Bangladesh"),
    e("\u{1F1E7}\u{1F1EA}", "Flag: Belgium"),
    e("\u{1F1E7}\u{1F1EB}", "Flag: Burkina Faso"),
    e("\u{1F1E7}\u{1F1EC}", "Flag: Bulgaria"),
    e("\u{1F1E7}\u{1F1ED}", "Flag: Bahrain"),
    e("\u{1F1E7}\u{1F1EE}", "Flag: Burundi"),
    e("\u{1F1E7}\u{1F1EF}", "Flag: Benin"),
    e("\u{1F1E7}\u{1F1F1}", "Flag: St. Barthélemy"),
    e("\u{1F1E7}\u{1F1F2}", "Flag: Bermuda"),
    e("\u{1F1E7}\u{1F1F3}", "Flag: Brunei"),
    e("\u{1F1E7}\u{1F1F4}", "Flag: Bolivia"),
    e("\u{1F1E7}\u{1F1F6}", "Flag: Caribbean Netherlands"),
    e("\u{1F1E7}\u{1F1F7}", "Flag: Brazil"),
    e("\u{1F1E7}\u{1F1F8}", "Flag: Bahamas"),
    e("\u{1F1E7}\u{1F1F9}", "Flag: Bhutan"),
    e("\u{1F1E7}\u{1F1FB}", "Flag: Bouvet Island"),
    e("\u{1F1E7}\u{1F1FC}", "Flag: Botswana"),
    e("\u{1F1E7}\u{1F1FE}", "Flag: Belarus"),
    e("\u{1F1E7}\u{1F1FF}", "Flag: Belize"),
    e("\u{1F1E8}\u{1F1E6}", "Flag: Canada"),
    e("\u{1F1E8}\u{1F1E8}", "Flag: Cocos (Keeling) Islands"),
    e("\u{1F1E8}\u{1F1E9}", "Flag: Congo - Kinshasa"),
    e("\u{1F1E8}\u{1F1EB}", "Flag: Central African Republic"),
    e("\u{1F1E8}\u{1F1EC}", "Flag: Congo - Brazzaville"),
    e("\u{1F1E8}\u{1F1ED}", "Flag: Switzerland"),
    e("\u{1F1E8}\u{1F1EE}", "Flag: Côte d’Ivoire"),
    e("\u{1F1E8}\u{1F1F0}", "Flag: Cook Islands"),
    e("\u{1F1E8}\u{1F1F1}", "Flag: Chile"),
    e("\u{1F1E8}\u{1F1F2}", "Flag: Cameroon"),
    e("\u{1F1E8}\u{1F1F3}", "Flag: China"),
    e("\u{1F1E8}\u{1F1F4}", "Flag: Colombia"),
    e("\u{1F1E8}\u{1F1F5}", "Flag: Clipperton Island"),
    e("\u{1F1E8}\u{1F1F7}", "Flag: Costa Rica"),
    e("\u{1F1E8}\u{1F1FA}", "Flag: Cuba"),
    e("\u{1F1E8}\u{1F1FB}", "Flag: Cape Verde"),
    e("\u{1F1E8}\u{1F1FC}", "Flag: Curaçao"),
    e("\u{1F1E8}\u{1F1FD}", "Flag: Christmas Island"),
    e("\u{1F1E8}\u{1F1FE}", "Flag: Cyprus"),
    e("\u{1F1E8}\u{1F1FF}", "Flag: Czechia"),
    e("\u{1F1E9}\u{1F1EA}", "Flag: Germany"),
    e("\u{1F1E9}\u{1F1EC}", "Flag: Diego Garcia"),
    e("\u{1F1E9}\u{1F1EF}", "Flag: Djibouti"),
    e("\u{1F1E9}\u{1F1F0}", "Flag: Denmark"),
    e("\u{1F1E9}\u{1F1F2}", "Flag: Dominica"),
    e("\u{1F1E9}\u{1F1F4}", "Flag: Dominican Republic"),
    e("\u{1F1E9}\u{1F1FF}", "Flag: Algeria"),
    e("\u{1F1EA}\u{1F1E6}", "Flag: Ceuta & Melilla"),
    e("\u{1F1EA}\u{1F1E8}", "Flag: Ecuador"),
    e("\u{1F1EA}\u{1F1EA}", "Flag: Estonia"),
    e("\u{1F1EA}\u{1F1EC}", "Flag: Egypt"),
    e("\u{1F1EA}\u{1F1ED}", "Flag: Western Sahara"),
    e("\u{1F1EA}\u{1F1F7}", "Flag: Eritrea"),
    e("\u{1F1EA}\u{1F1F8}", "Flag: Spain"),
    e("\u{1F1EA}\u{1F1F9}", "Flag: Ethiopia"),
    e("\u{1F1EA}\u{1F1FA}", "Flag: European Union"),
    e("\u{1F1EB}\u{1F1EE}", "Flag: Finland"),
    e("\u{1F1EB}\u{1F1EF}", "Flag: Fiji"),
    e("\u{1F1EB}\u{1F1F0}", "Flag: Falkland Islands"),
    e("\u{1F1EB}\u{1F1F2}", "Flag: Micronesia"),
    e("\u{1F1EB}\u{1F1F4}", "Flag: Faroe Islands"),
    e("\u{1F1EB}\u{1F1F7}", "Flag: France"),
    e("\u{1F1EC}\u{1F1E6}", "Flag: Gabon"),
    e("\u{1F1EC}\u{1F1E7}", "Flag: United Kingdom"),
    e("\u{1F1EC}\u{1F1E9}", "Flag: Grenada"),
    e("\u{1F1EC}\u{1F1EA}", "Flag: Georgia"),
    e("\u{1F1EC}\u{1F1EB}", "Flag: French Guiana"),
    e("\u{1F1EC}\u{1F1EC}", "Flag: Guernsey"),
    e("\u{1F1EC}\u{1F1ED}", "Flag: Ghana"),
    e("\u{1F1EC}\u{1F1EE}", "Flag: Gibraltar"),
    e("\u{1F1EC}\u{1F1F1}", "Flag: Greenland"),
    e("\u{1F1EC}\u{1F1F2}", "Flag: Gambia"),
    e("\u{1F1EC}\u{1F1F3}", "Flag: Guinea"),
    e("\u{1F1EC}\u{1F1F5}", "Flag: Guadeloupe"),
    e("\u{1F1EC}\u{1F1F6}", "Flag: Equatorial Guinea"),
    e("\u{1F1EC}\u{1F1F7}", "Flag: Greece"),
    e("\u{1F1EC}\u{1F1F8}", "Flag: South Georgia & South Sandwich Islands"),
    e("\u{1F1EC}\u{1F1F9}", "Flag: Guatemala"),
    e("\u{1F1EC}\u{1F1FA}", "Flag: Guam"),
    e("\u{1F1EC}\u{1F1FC}", "Flag: Guinea-Bissau"),
    e("\u{1F1EC}\u{1F1FE}", "Flag: Guyana"),
    e("\u{1F1ED}\u{1F1F0}", "Flag: Hong Kong SAR China"),
    e("\u{1F1ED}\u{1F1F2}", "Flag: Heard & McDonald Islands"),
    e("\u{1F1ED}\u{1F1F3}", "Flag: Honduras"),
    e("\u{1F1ED}\u{1F1F7}", "Flag: Croatia"),
    e("\u{1F1ED}\u{1F1F9}", "Flag: Haiti"),
    e("\u{1F1ED}\u{1F1FA}", "Flag: Hungary"),
    e("\u{1F1EE}\u{1F1E8}", "Flag: Canary Islands"),
    e("\u{1F1EE}\u{1F1E9}", "Flag: Indonesia"),
    e("\u{1F1EE}\u{1F1EA}", "Flag: Ireland"),
    e("\u{1F1EE}\u{1F1F1}", "Flag: Israel"),
    e("\u{1F1EE}\u{1F1F2}", "Flag: Isle of Man"),
    e("\u{1F1EE}\u{1F1F3}", "Flag: India"),
    e("\u{1F1EE}\u{1F1F4}", "Flag: British Indian Ocean Territory"),
    e("\u{1F1EE}\u{1F1F6}", "Flag: Iraq"),
    e("\u{1F1EE}\u{1F1F7}", "Flag: Iran"),
    e("\u{1F1EE}\u{1F1F8}", "Flag: Iceland"),
    e("\u{1F1EE}\u{1F1F9}", "Flag: Italy"),
    e("\u{1F1EF}\u{1F1EA}", "Flag: Jersey"),
    e("\u{1F1EF}\u{1F1F2}", "Flag: Jamaica"),
    e("\u{1F1EF}\u{1F1F4}", "Flag: Jordan"),
    e("\u{1F1EF}\u{1F1F5}", "Flag: Japan"),
    e("\u{1F1F0}\u{1F1EA}", "Flag: Kenya"),
    e("\u{1F1F0}\u{1F1EC}", "Flag: Kyrgyzstan"),
    e("\u{1F1F0}\u{1F1ED}", "Flag: Cambodia"),
    e("\u{1F1F0}\u{1F1EE}", "Flag: Kiribati"),
    e("\u{1F1F0}\u{1F1F2}", "Flag: Comoros"),
    e("\u{1F1F0}\u{1F1F3}", "Flag: St. Kitts & Nevis"),
    e("\u{1F1F0}\u{1F1F5}", "Flag: North Korea"),
    e("\u{1F1F0}\u{1F1F7}", "Flag: South Korea"),
    e("\u{1F1F0}\u{1F1FC}", "Flag: Kuwait"),
    e("\u{1F1F0}\u{1F1FE}", "Flag: Cayman Islands"),
    e("\u{1F1F0}\u{1F1FF}", "Flag: Kazakhstan"),
    e("\u{1F1F1}\u{1F1E6}", "Flag: Laos"),
    e("\u{1F1F1}\u{1F1E7}", "Flag: Lebanon"),
    e("\u{1F1F1}\u{1F1E8}", "Flag: St. Lucia"),
    e("\u{1F1F1}\u{1F1EE}", "Flag: Liechtenstein"),
    e("\u{1F1F1}\u{1F1F0}", "Flag: Sri Lanka"),
    e("\u{1F1F1}\u{1F1F7}", "Flag: Liberia"),
    e("\u{1F1F1}\u{1F1F8}", "Flag: Lesotho"),
    e("\u{1F1F1}\u{1F1F9}", "Flag: Lithuania"),
    e("\u{1F1F1}\u{1F1FA}", "Flag: Luxembourg"),
    e("\u{1F1F1}\u{1F1FB}", "Flag: Latvia"),
    e("\u{1F1F1}\u{1F1FE}", "Flag: Libya"),
    e("\u{1F1F2}\u{1F1E6}", "Flag: Morocco"),
    e("\u{1F1F2}\u{1F1E8}", "Flag: Monaco"),
    e("\u{1F1F2}\u{1F1E9}", "Flag: Moldova"),
    e("\u{1F1F2}\u{1F1EA}", "Flag: Montenegro"),
    e("\u{1F1F2}\u{1F1EB}", "Flag: St. Martin"),
    e("\u{1F1F2}\u{1F1EC}", "Flag: Madagascar"),
    e("\u{1F1F2}\u{1F1ED}", "Flag: Marshall Islands"),
    e("\u{1F1F2}\u{1F1F0}", "Flag: North Macedonia"),
    e("\u{1F1F2}\u{1F1F1}", "Flag: Mali"),
    e("\u{1F1F2}\u{1F1F2}", "Flag: Myanmar (Burma)"),
    e("\u{1F1F2}\u{1F1F3}", "Flag: Mongolia"),
    e("\u{1F1F2}\u{1F1F4}", "Flag: Macao Sar China"),
    e("\u{1F1F2}\u{1F1F5}", "Flag: Northern Mariana Islands"),
    e("\u{1F1F2}\u{1F1F6}", "Flag: Martinique"),
    e("\u{1F1F2}\u{1F1F7}", "Flag: Mauritania"),
    e("\u{1F1F2}\u{1F1F8}", "Flag: Montserrat"),
    e("\u{1F1F2}\u{1F1F9}", "Flag: Malta"),
    e("\u{1F1F2}\u{1F1FA}", "Flag: Mauritius"),
    e("\u{1F1F2}\u{1F1FB}", "Flag: Maldives"),
    e("\u{1F1F2}\u{1F1FC}", "Flag: Malawi"),
    e("\u{1F1F2}\u{1F1FD}", "Flag: Mexico"),
    e("\u{1F1F2}\u{1F1FE}", "Flag: Malaysia"),
    e("\u{1F1F2}\u{1F1FF}", "Flag: Mozambique"),
    e("\u{1F1F3}\u{1F1E6}", "Flag: Namibia"),
    e("\u{1F1F3}\u{1F1E8}", "Flag: New Caledonia"),
    e("\u{1F1F3}\u{1F1EA}", "Flag: Niger"),
    e("\u{1F1F3}\u{1F1EB}", "Flag: Norfolk Island"),
    e("\u{1F1F3}\u{1F1EC}", "Flag: Nigeria"),
    e("\u{1F1F3}\u{1F1EE}", "Flag: Nicaragua"),
    e("\u{1F1F3}\u{1F1F1}", "Flag: Netherlands"),
    e("\u{1F1F3}\u{1F1F4}", "Flag: Norway"),
    e("\u{1F1F3}\u{1F1F5}", "Flag: Nepal"),
    e("\u{1F1F3}\u{1F1F7}", "Flag: Nauru"),
    e("\u{1F1F3}\u{1F1FA}", "Flag: Niue"),
    e("\u{1F1F3}\u{1F1FF}", "Flag: New Zealand"),
    e("\u{1F1F4}\u{1F1F2}", "Flag: Oman"),
    e("\u{1F1F5}\u{1F1E6}", "Flag: Panama"),
    e("\u{1F1F5}\u{1F1EA}", "Flag: Peru"),
    e("\u{1F1F5}\u{1F1EB}", "Flag: French Polynesia"),
    e("\u{1F1F5}\u{1F1EC}", "Flag: Papua New Guinea"),
    e("\u{1F1F5}\u{1F1ED}", "Flag: Philippines"),
    e("\u{1F1F5}\u{1F1F0}", "Flag: Pakistan"),
    e("\u{1F1F5}\u{1F1F1}", "Flag: Poland"),
    e("\u{1F1F5}\u{1F1F2}", "Flag: St. Pierre & Miquelon"),
    e("\u{1F1F5}\u{1F1F3}", "Flag: Pitcairn Islands"),
    e("\u{1F1F5}\u{1F1F7}", "Flag: Puerto Rico"),
    e("\u{1F1F5}\u{1F1F8}", "Flag: Palestinian Territories"),
    e("\u{1F1F5}\u{1F1F9}", "Flag: Portugal"),
    e("\u{1F1F5}\u{1F1FC}", "Flag: Palau"),
    e("\u{1F1F5}\u{1F1FE}", "Flag: Paraguay"),
    e("\u{1F1F6}\u{1F1E6}", "Flag: Qatar"),
    e("\u{1F1F7}\u{1F1EA}", "Flag: Réunion"),
    e("\u{1F1F7}\u{1F1F4}", "Flag: Romania"),
    e("\u{1F1F7}\u{1F1F8}", "Flag: Serbia"),
    e("\u{1F1F7}\u{1F1FA}", "Flag: Russia"),
    e("\u{1F1F7}\u{1F1FC}", "Flag: Rwanda"),
    e("\u{1F1F8}\u{1F1E6}", "Flag: Saudi Arabia"),
    e("\u{1F1F8}\u{1F1E7}", "Flag: Solomon Islands"),
    e("\u{1F1F8}\u{1F1E8}", "Flag: Seychelles"),
    e("\u{1F1F8}\u{1F1E9}", "Flag: Sudan"),
    e("\u{1F1F8}\u{1F1EA}", "Flag: Sweden"),
    e("\u{1F1F8}\u{1F1EC}", "Flag: Singapore"),
    e("\u{1F1F8}\u{1F1ED}", "Flag: St. Helena"),
    e("\u{1F1F8}\u{1F1EE}", "Flag: Slovenia"),
    e("\u{1F1F8}\u{1F1EF}", "Flag: Svalbard & Jan Mayen"),
    e("\u{1F1F8}\u{1F1F0}", "Flag: Slovakia"),
    e("\u{1F1F8}\u{1F1F1}", "Flag: Sierra Leone"),
    e("\u{1F1F8}\u{1F1F2}", "Flag: San Marino"),
    e("\u{1F1F8}\u{1F1F3}", "Flag: Senegal"),
    e("\u{1F1F8}\u{1F1F4}", "Flag: Somalia"),
    e("\u{1F1F8}\u{1F1F7}", "Flag: Suriname"),
    e("\u{1F1F8}\u{1F1F8}", "Flag: South Sudan"),
    e("\u{1F1F8}\u{1F1F9}", "Flag: São Tomé & Príncipe"),
    e("\u{1F1F8}\u{1F1FB}", "Flag: El Salvador"),
    e("\u{1F1F8}\u{1F1FD}", "Flag: Sint Maarten"),
    e("\u{1F1F8}\u{1F1FE}", "Flag: Syria"),
    e("\u{1F1F8}\u{1F1FF}", "Flag: Eswatini"),
    e("\u{1F1F9}\u{1F1E6}", "Flag: Tristan Da Cunha"),
    e("\u{1F1F9}\u{1F1E8}", "Flag: Turks & Caicos Islands"),
    e("\u{1F1F9}\u{1F1E9}", "Flag: Chad"),
    e("\u{1F1F9}\u{1F1EB}", "Flag: French Southern Territories"),
    e("\u{1F1F9}\u{1F1EC}", "Flag: Togo"),
    e("\u{1F1F9}\u{1F1ED}", "Flag: Thailand"),
    e("\u{1F1F9}\u{1F1EF}", "Flag: Tajikistan"),
    e("\u{1F1F9}\u{1F1F0}", "Flag: Tokelau"),
    e("\u{1F1F9}\u{1F1F1}", "Flag: Timor-Leste"),
    e("\u{1F1F9}\u{1F1F2}", "Flag: Turkmenistan"),
    e("\u{1F1F9}\u{1F1F3}", "Flag: Tunisia"),
    e("\u{1F1F9}\u{1F1F4}", "Flag: Tonga"),
    e("\u{1F1F9}\u{1F1F7}", "Flag: Turkey"),
    e("\u{1F1F9}\u{1F1F9}", "Flag: Trinidad & Tobago"),
    e("\u{1F1F9}\u{1F1FB}", "Flag: Tuvalu"),
    e("\u{1F1F9}\u{1F1FC}", "Flag: Taiwan"),
    e("\u{1F1F9}\u{1F1FF}", "Flag: Tanzania"),
    e("\u{1F1FA}\u{1F1E6}", "Flag: Ukraine"),
    e("\u{1F1FA}\u{1F1EC}", "Flag: Uganda"),
    e("\u{1F1FA}\u{1F1F2}", "Flag: U.S. Outlying Islands"),
    e("\u{1F1FA}\u{1F1F3}", "Flag: United Nations"),
    e("\u{1F1FA}\u{1F1F8}", "Flag: United States"),
    e("\u{1F1FA}\u{1F1FE}", "Flag: Uruguay"),
    e("\u{1F1FA}\u{1F1FF}", "Flag: Uzbekistan"),
    e("\u{1F1FB}\u{1F1E6}", "Flag: Vatican City"),
    e("\u{1F1FB}\u{1F1E8}", "Flag: St. Vincent & Grenadines"),
    e("\u{1F1FB}\u{1F1EA}", "Flag: Venezuela"),
    e("\u{1F1FB}\u{1F1EC}", "Flag: British Virgin Islands"),
    e("\u{1F1FB}\u{1F1EE}", "Flag: U.S. Virgin Islands"),
    e("\u{1F1FB}\u{1F1F3}", "Flag: Vietnam"),
    e("\u{1F1FB}\u{1F1FA}", "Flag: Vanuatu"),
    e("\u{1F1FC}\u{1F1EB}", "Flag: Wallis & Futuna"),
    e("\u{1F1FC}\u{1F1F8}", "Flag: Samoa"),
    e("\u{1F1FD}\u{1F1F0}", "Flag: Kosovo"),
    e("\u{1F1FE}\u{1F1EA}", "Flag: Yemen"),
    e("\u{1F1FE}\u{1F1F9}", "Flag: Mayotte"),
    e("\u{1F1FF}\u{1F1E6}", "Flag: South Africa"),
    e("\u{1F1FF}\u{1F1F2}", "Flag: Zambia"),
    e("\u{1F1FF}\u{1F1FC}", "Flag: Zimbabwe"));

const flags = g(
    "Flags", "Basic flags",
    e("\u{1F38C}", "Crossed Flags"),
    e("\u{1F3C1}", "Chequered Flag"),
    e("\u{1F3F3}\u{FE0F}", "White Flag"),
    e("\u{1F3F3}\u{FE0F}\u{200D}\u{1F308}", "Rainbow Flag"),
    //e("\u{1F3F3}\u{FE0F}\u{200D}\u{26A7}\u{FE0F}", "Transgender Flag"),
    e("\u{1F3F4}", "Black Flag"),
    //e("\u{1F3F4}\u{200D}\u{2620}\u{FE0F}", "Pirate Flag"),
    e("\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}", "Flag: England"),
    e("\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}", "Flag: Scotland"),
    e("\u{1F3F4}\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}", "Flag: Wales"),
    e("\u{1F6A9}", "Triangular Flag"));

const motorcycle = e("\u{1F3CD}\u{FE0F}", "Motorcycle");
const racingCar = e("\u{1F3CE}\u{FE0F}", "Racing Car");
const seat = e("\u{1F4BA}", "Seat");
const helicopter = e("\u{1F681}", "Helicopter");
const locomotive = e("\u{1F682}", "Locomotive");
const railwayCar = e("\u{1F683}", "Railway Car");
const highspeedTrain = e("\u{1F684}", "High-Speed Train");
const bulletTrain = e("\u{1F685}", "Bullet Train");
const train = e("\u{1F686}", "Train");
const metro = e("\u{1F687}", "Metro");
const lightRail = e("\u{1F688}", "Light Rail");
const station = e("\u{1F689}", "Station");
const tram = e("\u{1F68A}", "Tram");
const tramCar = e("\u{1F68B}", "Tram Car");
const bus = e("\u{1F68C}", "Bus");
const oncomingBus = e("\u{1F68D}", "Oncoming Bus");
const trolleyBus = e("\u{1F68E}", "Trolleybus");
const busStop = e("\u{1F68F}", "Bus Stop");
const miniBus = e("\u{1F690}", "Minibus");
const ambulance = e("\u{1F691}", "Ambulance");
const policeCar = e("\u{1F693}", "Police Car");
const oncomingPoliceCar = e("\u{1F694}", "Oncoming Police Car");
const taxi = e("\u{1F695}", "Taxi");
const oncomingTaxi = e("\u{1F696}", "Oncoming Taxi");
const automobile = e("\u{1F697}", "Automobile");
const oncomingAutomobile = e("\u{1F698}", "Oncoming Automobile");
const sportUtilityVehicle = e("\u{1F699}", "Sport Utility Vehicle");
const deliveryTruck = e("\u{1F69A}", "Delivery Truck");
const articulatedLorry = e("\u{1F69B}", "Articulated Lorry");
const tractor = e("\u{1F69C}", "Tractor");
const monorail = e("\u{1F69D}", "Monorail");
const mountainRailway = e("\u{1F69E}", "Mountain Railway");
const suspensionRailway = e("\u{1F69F}", "Suspension Railway");
const mountainCableway = e("\u{1F6A0}", "Mountain Cableway");
const aerialTramway = e("\u{1F6A1}", "Aerial Tramway");
const ship = e("\u{1F6A2}", "Ship");
const speedBoat = e("\u{1F6A4}", "Speedboat");
const horizontalTrafficLight = e("\u{1F6A5}", "Horizontal Traffic Light");
const verticalTrafficLight = e("\u{1F6A6}", "Vertical Traffic Light");
const construction = e("\u{1F6A7}", "Construction");
const policeCarLight = e("\u{1F6A8}", "Police Car Light");
const bicycle = e("\u{1F6B2}", "Bicycle");
const stopSign = e("\u{1F6D1}", "Stop Sign");
const oilDrum = e("\u{1F6E2}\u{FE0F}", "Oil Drum");
const motorway = e("\u{1F6E3}\u{FE0F}", "Motorway");
const railwayTrack = e("\u{1F6E4}\u{FE0F}", "Railway Track");
const motorBoat = e("\u{1F6E5}\u{FE0F}", "Motor Boat");
const smallAirplane = e("\u{1F6E9}\u{FE0F}", "Small Airplane");
const airplaneDeparture = e("\u{1F6EB}", "Airplane Departure");
const airplaneArrival = e("\u{1F6EC}", "Airplane Arrival");
const satellite = e("\u{1F6F0}\u{FE0F}", "Satellite");
const passengerShip = e("\u{1F6F3}\u{FE0F}", "Passenger Ship");
const kickScooter = e("\u{1F6F4}", "Kick Scooter");
const motorScooter = e("\u{1F6F5}", "Motor Scooter");
const canoe = e("\u{1F6F6}", "Canoe");
const flyingSaucer = e("\u{1F6F8}", "Flying Saucer");
const skateboard = e("\u{1F6F9}", "Skateboard");
const autoRickshaw = e("\u{1F6FA}", "Auto Rickshaw");
//export const pickupTruck = e("\u{1F6FB}", "Pickup Truck");
//export const rollerSkate = e("\u{1F6FC}", "Roller Skate");
const parachute = e("\u{1FA82}", "Parachute");
const anchor = e("\u{2693}", "Anchor");
const ferry = e("\u{26F4}\u{FE0F}", "Ferry");
const sailboat = e("\u{26F5}", "Sailboat");
const fuelPump = e("\u{26FD}", "Fuel Pump");
const vehicles = g(
    "Vehicles", "Things that go",
    motorcycle,
    racingCar,
    seat,
    rocket,
    helicopter,
    locomotive,
    railwayCar,
    highspeedTrain,
    bulletTrain,
    train,
    metro,
    lightRail,
    station,
    tram,
    tramCar,
    bus,
    oncomingBus,
    trolleyBus,
    busStop,
    miniBus,
    ambulance,
    fireEngine,
    taxi,
    oncomingTaxi,
    automobile,
    oncomingAutomobile,
    sportUtilityVehicle,
    deliveryTruck,
    articulatedLorry,
    tractor,
    monorail,
    mountainRailway,
    suspensionRailway,
    mountainCableway,
    aerialTramway,
    ship,
    speedBoat,
    horizontalTrafficLight,
    verticalTrafficLight,
    construction,
    bicycle,
    stopSign,
    oilDrum,
    motorway,
    railwayTrack,
    motorBoat,
    smallAirplane,
    airplaneDeparture,
    airplaneArrival,
    satellite,
    passengerShip,
    kickScooter,
    motorScooter,
    canoe,
    flyingSaucer,
    skateboard,
    autoRickshaw,
    //pickupTruck,
    //rollerSkate,
    motorizedWheelchair,
    manualWheelchair,
    parachute,
    anchor,
    ferry,
    sailboat,
    fuelPump,
    airplane);

const bloodTypes = g(
    "Blood Types", "Blood types",
    e("\u{1F170}", "A Button (Blood Type)"),
    e("\u{1F171}", "B Button (Blood Type)"),
    e("\u{1F17E}", "O Button (Blood Type)"),
    e("\u{1F18E}", "AB Button (Blood Type)"));

const regionIndicators = g(
    "Regions", "Region indicators",
    e("\u{1F1E6}", "Regional Indicator Symbol Letter A"),
    e("\u{1F1E7}", "Regional Indicator Symbol Letter B"),
    e("\u{1F1E8}", "Regional Indicator Symbol Letter C"),
    e("\u{1F1E9}", "Regional Indicator Symbol Letter D"),
    e("\u{1F1EA}", "Regional Indicator Symbol Letter E"),
    e("\u{1F1EB}", "Regional Indicator Symbol Letter F"),
    e("\u{1F1EC}", "Regional Indicator Symbol Letter G"),
    e("\u{1F1ED}", "Regional Indicator Symbol Letter H"),
    e("\u{1F1EE}", "Regional Indicator Symbol Letter I"),
    e("\u{1F1EF}", "Regional Indicator Symbol Letter J"),
    e("\u{1F1F0}", "Regional Indicator Symbol Letter K"),
    e("\u{1F1F1}", "Regional Indicator Symbol Letter L"),
    e("\u{1F1F2}", "Regional Indicator Symbol Letter M"),
    e("\u{1F1F3}", "Regional Indicator Symbol Letter N"),
    e("\u{1F1F4}", "Regional Indicator Symbol Letter O"),
    e("\u{1F1F5}", "Regional Indicator Symbol Letter P"),
    e("\u{1F1F6}", "Regional Indicator Symbol Letter Q"),
    e("\u{1F1F7}", "Regional Indicator Symbol Letter R"),
    e("\u{1F1F8}", "Regional Indicator Symbol Letter S"),
    e("\u{1F1F9}", "Regional Indicator Symbol Letter T"),
    e("\u{1F1FA}", "Regional Indicator Symbol Letter U"),
    e("\u{1F1FB}", "Regional Indicator Symbol Letter V"),
    e("\u{1F1FC}", "Regional Indicator Symbol Letter W"),
    e("\u{1F1FD}", "Regional Indicator Symbol Letter X"),
    e("\u{1F1FE}", "Regional Indicator Symbol Letter Y"),
    e("\u{1F1FF}", "Regional Indicator Symbol Letter Z"));

const japanese = g(
    "Japanese", "Japanse symbology",
    e("\u{1F530}", "Japanese Symbol for Beginner"),
    e("\u{1F201}", "Japanese “Here” Button"),
    e("\u{1F202}\u{FE0F}", "Japanese “Service Charge” Button"),
    e("\u{1F21A}", "Japanese “Free of Charge” Button"),
    e("\u{1F22F}", "Japanese “Reserved” Button"),
    e("\u{1F232}", "Japanese “Prohibited” Button"),
    e("\u{1F233}", "Japanese “Vacancy” Button"),
    e("\u{1F234}", "Japanese “Passing Grade” Button"),
    e("\u{1F235}", "Japanese “No Vacancy” Button"),
    e("\u{1F236}", "Japanese “Not Free of Charge” Button"),
    e("\u{1F237}\u{FE0F}", "Japanese “Monthly Amount” Button"),
    e("\u{1F238}", "Japanese “Application” Button"),
    e("\u{1F239}", "Japanese “Discount” Button"),
    e("\u{1F23A}", "Japanese “Open for Business” Button"),
    e("\u{1F250}", "Japanese “Bargain” Button"),
    e("\u{1F251}", "Japanese “Acceptable” Button"),
    e("\u{3297}\u{FE0F}", "Japanese “Congratulations” Button"),
    e("\u{3299}\u{FE0F}", "Japanese “Secret” Button"));

const clocks = g(
    "Clocks", "Time-keeping pieces",
    e("\u{1F550}", "One O’Clock"),
    e("\u{1F551}", "Two O’Clock"),
    e("\u{1F552}", "Three O’Clock"),
    e("\u{1F553}", "Four O’Clock"),
    e("\u{1F554}", "Five O’Clock"),
    e("\u{1F555}", "Six O’Clock"),
    e("\u{1F556}", "Seven O’Clock"),
    e("\u{1F557}", "Eight O’Clock"),
    e("\u{1F558}", "Nine O’Clock"),
    e("\u{1F559}", "Ten O’Clock"),
    e("\u{1F55A}", "Eleven O’Clock"),
    e("\u{1F55B}", "Twelve O’Clock"),
    e("\u{1F55C}", "One-Thirty"),
    e("\u{1F55D}", "Two-Thirty"),
    e("\u{1F55E}", "Three-Thirty"),
    e("\u{1F55F}", "Four-Thirty"),
    e("\u{1F560}", "Five-Thirty"),
    e("\u{1F561}", "Six-Thirty"),
    e("\u{1F562}", "Seven-Thirty"),
    e("\u{1F563}", "Eight-Thirty"),
    e("\u{1F564}", "Nine-Thirty"),
    e("\u{1F565}", "Ten-Thirty"),
    e("\u{1F566}", "Eleven-Thirty"),
    e("\u{1F567}", "Twelve-Thirty"),
    e("\u{1F570}\u{FE0F}", "Mantelpiece Clock"),
    e("\u{231A}", "Watch"),
    e("\u{23F0}", "Alarm Clock"),
    e("\u{23F1}\u{FE0F}", "Stopwatch"),
    e("\u{23F2}\u{FE0F}", "Timer Clock"),
    e("\u{231B}", "Hourglass Done"),
    e("\u{23F3}", "Hourglass Not Done"));

const clockwiseVerticalArrows = e("\u{1F503}\u{FE0F}", "Clockwise Vertical Arrows");
const counterclockwiseArrowsButton = e("\u{1F504}\u{FE0F}", "Counterclockwise Arrows Button");
const leftRightArrow = e("\u{2194}\u{FE0F}", "Left-Right Arrow");
const upDownArrow = e("\u{2195}\u{FE0F}", "Up-Down Arrow");
const upLeftArrow = e("\u{2196}\u{FE0F}", "Up-Left Arrow");
const upRightArrow = e("\u{2197}\u{FE0F}", "Up-Right Arrow");
const downRightArrow = e("\u{2198}", "Down-Right Arrow");
const downRightArrowText = e("\u{2198}\u{FE0E}", "Down-Right Arrow");
const downRightArrowEmoji = e("\u{2198}\u{FE0F}", "Down-Right Arrow");
const downLeftArrow = e("\u{2199}\u{FE0F}", "Down-Left Arrow");
const rightArrowCurvingLeft = e("\u{21A9}\u{FE0F}", "Right Arrow Curving Left");
const leftArrowCurvingRight = e("\u{21AA}\u{FE0F}", "Left Arrow Curving Right");
const rightArrow = e("\u{27A1}\u{FE0F}", "Right Arrow");
const rightArrowCurvingUp = e("\u{2934}\u{FE0F}", "Right Arrow Curving Up");
const rightArrowCurvingDown = e("\u{2935}\u{FE0F}", "Right Arrow Curving Down");
const leftArrow = e("\u{2B05}\u{FE0F}", "Left Arrow");
const upArrow = e("\u{2B06}\u{FE0F}", "Up Arrow");
const downArrow = e("\u{2B07}\u{FE0F}", "Down Arrow");
const arrows = g(
    "Arrows", "Arrows pointing in different directions",
    clockwiseVerticalArrows,
    counterclockwiseArrowsButton,
    leftRightArrow,
    upDownArrow,
    upLeftArrow,
    upRightArrow,
    downRightArrowEmoji,
    downLeftArrow,
    rightArrowCurvingLeft,
    leftArrowCurvingRight,
    rightArrow,
    rightArrowCurvingUp,
    rightArrowCurvingDown,
    leftArrow,
    upArrow,
    downArrow);

const shapes = g(
    "Shapes", "Colored shapes",
    e("\u{1F534}", "Red Circle"),
    e("\u{1F535}", "Blue Circle"),
    e("\u{1F536}", "Large Orange Diamond"),
    e("\u{1F537}", "Large Blue Diamond"),
    e("\u{1F538}", "Small Orange Diamond"),
    e("\u{1F539}", "Small Blue Diamond"),
    e("\u{1F53A}", "Red Triangle Pointed Up"),
    e("\u{1F53B}", "Red Triangle Pointed Down"),
    e("\u{1F7E0}", "Orange Circle"),
    e("\u{1F7E1}", "Yellow Circle"),
    e("\u{1F7E2}", "Green Circle"),
    e("\u{1F7E3}", "Purple Circle"),
    e("\u{1F7E4}", "Brown Circle"),
    e("\u{2B55}", "Hollow Red Circle"),
    e("\u{26AA}", "White Circle"),
    e("\u{26AB}", "Black Circle"),
    e("\u{1F7E5}", "Red Square"),
    e("\u{1F7E6}", "Blue Square"),
    e("\u{1F7E7}", "Orange Square"),
    e("\u{1F7E8}", "Yellow Square"),
    e("\u{1F7E9}", "Green Square"),
    e("\u{1F7EA}", "Purple Square"),
    e("\u{1F7EB}", "Brown Square"),
    e("\u{1F532}", "Black Square Button"),
    e("\u{1F533}", "White Square Button"),
    e("\u{25AA}\u{FE0F}", "Black Small Square"),
    e("\u{25AB}\u{FE0F}", "White Small Square"),
    e("\u{25FD}", "White Medium-Small Square"),
    e("\u{25FE}", "Black Medium-Small Square"),
    e("\u{25FB}\u{FE0F}", "White Medium Square"),
    e("\u{25FC}\u{FE0F}", "Black Medium Square"),
    e("\u{2B1B}", "Black Large Square"),
    e("\u{2B1C}", "White Large Square"),
    e("\u{2B50}", "Star"),
    e("\u{1F4A0}", "Diamond with a Dot"));

const clearButton = e("\u{1F191}", "CL Button");
const coolButton = e("\u{1F192}", "Cool Button");
const freeButton = e("\u{1F193}", "Free Button");
const idButton = e("\u{1F194}", "ID Button");
const newButton = e("\u{1F195}", "New Button");
const ngButton = e("\u{1F196}", "NG Button");
const okButton = e("\u{1F197}", "OK Button");
const sosButton = e("\u{1F198}", "SOS Button");
const upButton = e("\u{1F199}", "Up! Button");
const vsButton = e("\u{1F19A}", "Vs Button");
const radioButton = e("\u{1F518}", "Radio Button");
const backArrow = e("\u{1F519}", "Back Arrow");
const endArrow = e("\u{1F51A}", "End Arrow");
const onArrow = e("\u{1F51B}", "On! Arrow");
const soonArrow = e("\u{1F51C}", "Soon Arrow");
const topArrow = e("\u{1F51D}", "Top Arrow");
const checkBoxWithCheck = e("\u{2611}\u{FE0F}", "Check Box with Check");
const inputLatinUppercase = e("\u{1F520}", "Input Latin Uppercase");
const inputLatinLowercase = e("\u{1F521}", "Input Latin Lowercase");
const inputNumbers = e("\u{1F522}", "Input Numbers");
const inputSymbols = e("\u{1F523}", "Input Symbols");
const inputLatinLetters = e("\u{1F524}", "Input Latin Letters");
const shuffleTracksButton = e("\u{1F500}", "Shuffle Tracks Button");
const repeatButton = e("\u{1F501}", "Repeat Button");
const repeatSingleButton = e("\u{1F502}", "Repeat Single Button");
const upwardsButton = e("\u{1F53C}", "Upwards Button");
const downwardsButton = e("\u{1F53D}", "Downwards Button");
const playButton = e("\u{25B6}\u{FE0F}", "Play Button");
const reverseButton = e("\u{25C0}\u{FE0F}", "Reverse Button");
const ejectButton = e("\u{23CF}\u{FE0F}", "Eject Button");
const fastForwardButton = e("\u{23E9}", "Fast-Forward Button");
const fastReverseButton = e("\u{23EA}", "Fast Reverse Button");
const fastUpButton = e("\u{23EB}", "Fast Up Button");
const fastDownButton = e("\u{23EC}", "Fast Down Button");
const nextTrackButton = e("\u{23ED}\u{FE0F}", "Next Track Button");
const lastTrackButton = e("\u{23EE}\u{FE0F}", "Last Track Button");
const playOrPauseButton = e("\u{23EF}\u{FE0F}", "Play or Pause Button");
const pauseButton = e("\u{23F8}\u{FE0F}", "Pause Button");
const stopButton = e("\u{23F9}\u{FE0F}", "Stop Button");
const recordButton = e("\u{23FA}\u{FE0F}", "Record Button");
const buttons = g(
    "Buttons", "Buttons",
    clearButton,
    coolButton,
    freeButton,
    idButton,
    newButton,
    ngButton,
    okButton,
    sosButton,
    upButton,
    vsButton,
    radioButton,
    backArrow,
    endArrow,
    onArrow,
    soonArrow,
    topArrow,
    checkBoxWithCheck,
    inputLatinUppercase,
    inputLatinLowercase,
    inputNumbers,
    inputSymbols,
    inputLatinLetters,
    shuffleTracksButton,
    repeatButton,
    repeatSingleButton,
    upwardsButton,
    downwardsButton,
    playButton,
    pauseButton,
    reverseButton,
    ejectButton,
    fastForwardButton,
    fastReverseButton,
    fastUpButton,
    fastDownButton,
    nextTrackButton,
    lastTrackButton,
    playOrPauseButton,
    pauseButton,
    stopButton,
    recordButton);

const zodiac = g(
    "Zodiac", "The symbology of astrology",
    e("\u{2648}", "Aries"),
    e("\u{2649}", "Taurus"),
    e("\u{264A}", "Gemini"),
    e("\u{264B}", "Cancer"),
    e("\u{264C}", "Leo"),
    e("\u{264D}", "Virgo"),
    e("\u{264E}", "Libra"),
    e("\u{264F}", "Scorpio"),
    e("\u{2650}", "Sagittarius"),
    e("\u{2651}", "Capricorn"),
    e("\u{2652}", "Aquarius"),
    e("\u{2653}", "Pisces"),
    e("\u{26CE}", "Ophiuchus"));

const numbers = g(
    "Numbers", "Numbers",
    e("\u{30}\u{FE0F}", "Digit Zero"),
    e("\u{31}\u{FE0F}", "Digit One"),
    e("\u{32}\u{FE0F}", "Digit Two"),
    e("\u{33}\u{FE0F}", "Digit Three"),
    e("\u{34}\u{FE0F}", "Digit Four"),
    e("\u{35}\u{FE0F}", "Digit Five"),
    e("\u{36}\u{FE0F}", "Digit Six"),
    e("\u{37}\u{FE0F}", "Digit Seven"),
    e("\u{38}\u{FE0F}", "Digit Eight"),
    e("\u{39}\u{FE0F}", "Digit Nine"),
    e("\u{2A}\u{FE0F}", "Asterisk"),
    e("\u{23}\u{FE0F}", "Number Sign"),
    e("\u{30}\u{FE0F}\u{20E3}", "Keycap Digit Zero"),
    e("\u{31}\u{FE0F}\u{20E3}", "Keycap Digit One"),
    e("\u{32}\u{FE0F}\u{20E3}", "Keycap Digit Two"),
    e("\u{33}\u{FE0F}\u{20E3}", "Keycap Digit Three"),
    e("\u{34}\u{FE0F}\u{20E3}", "Keycap Digit Four"),
    e("\u{35}\u{FE0F}\u{20E3}", "Keycap Digit Five"),
    e("\u{36}\u{FE0F}\u{20E3}", "Keycap Digit Six"),
    e("\u{37}\u{FE0F}\u{20E3}", "Keycap Digit Seven"),
    e("\u{38}\u{FE0F}\u{20E3}", "Keycap Digit Eight"),
    e("\u{39}\u{FE0F}\u{20E3}", "Keycap Digit Nine"),
    e("\u{2A}\u{FE0F}\u{20E3}", "Keycap Asterisk"),
    e("\u{23}\u{FE0F}\u{20E3}", "Keycap Number Sign"),
    e("\u{1F51F}", "Keycap: 10"));

const tagPlusSign = e("\u{E002B}", "Tag Plus Sign");
const tagMinusHyphen = e("\u{E002D}", "Tag Hyphen-Minus");
const tags = g(
    "Tags", "Tags",
    e("\u{E0020}", "Tag Space"),
    e("\u{E0021}", "Tag Exclamation Mark"),
    e("\u{E0022}", "Tag Quotation Mark"),
    e("\u{E0023}", "Tag Number Sign"),
    e("\u{E0024}", "Tag Dollar Sign"),
    e("\u{E0025}", "Tag Percent Sign"),
    e("\u{E0026}", "Tag Ampersand"),
    e("\u{E0027}", "Tag Apostrophe"),
    e("\u{E0028}", "Tag Left Parenthesis"),
    e("\u{E0029}", "Tag Right Parenthesis"),
    e("\u{E002A}", "Tag Asterisk"),
    tagPlusSign,
    e("\u{E002C}", "Tag Comma"),
    tagMinusHyphen,
    e("\u{E002E}", "Tag Full Stop"),
    e("\u{E002F}", "Tag Solidus"),
    e("\u{E0030}", "Tag Digit Zero"),
    e("\u{E0031}", "Tag Digit One"),
    e("\u{E0032}", "Tag Digit Two"),
    e("\u{E0033}", "Tag Digit Three"),
    e("\u{E0034}", "Tag Digit Four"),
    e("\u{E0035}", "Tag Digit Five"),
    e("\u{E0036}", "Tag Digit Six"),
    e("\u{E0037}", "Tag Digit Seven"),
    e("\u{E0038}", "Tag Digit Eight"),
    e("\u{E0039}", "Tag Digit Nine"),
    e("\u{E003A}", "Tag Colon"),
    e("\u{E003B}", "Tag Semicolon"),
    e("\u{E003C}", "Tag Less-Than Sign"),
    e("\u{E003D}", "Tag Equals Sign"),
    e("\u{E003E}", "Tag Greater-Than Sign"),
    e("\u{E003F}", "Tag Question Mark"),
    e("\u{E0040}", "Tag Commercial at"),
    e("\u{E0041}", "Tag Latin Capital Letter a"),
    e("\u{E0042}", "Tag Latin Capital Letter B"),
    e("\u{E0043}", "Tag Latin Capital Letter C"),
    e("\u{E0044}", "Tag Latin Capital Letter D"),
    e("\u{E0045}", "Tag Latin Capital Letter E"),
    e("\u{E0046}", "Tag Latin Capital Letter F"),
    e("\u{E0047}", "Tag Latin Capital Letter G"),
    e("\u{E0048}", "Tag Latin Capital Letter H"),
    e("\u{E0049}", "Tag Latin Capital Letter I"),
    e("\u{E004A}", "Tag Latin Capital Letter J"),
    e("\u{E004B}", "Tag Latin Capital Letter K"),
    e("\u{E004C}", "Tag Latin Capital Letter L"),
    e("\u{E004D}", "Tag Latin Capital Letter M"),
    e("\u{E004E}", "Tag Latin Capital Letter N"),
    e("\u{E004F}", "Tag Latin Capital Letter O"),
    e("\u{E0050}", "Tag Latin Capital Letter P"),
    e("\u{E0051}", "Tag Latin Capital Letter Q"),
    e("\u{E0052}", "Tag Latin Capital Letter R"),
    e("\u{E0053}", "Tag Latin Capital Letter S"),
    e("\u{E0054}", "Tag Latin Capital Letter T"),
    e("\u{E0055}", "Tag Latin Capital Letter U"),
    e("\u{E0056}", "Tag Latin Capital Letter V"),
    e("\u{E0057}", "Tag Latin Capital Letter W"),
    e("\u{E0058}", "Tag Latin Capital Letter X"),
    e("\u{E0059}", "Tag Latin Capital Letter Y"),
    e("\u{E005A}", "Tag Latin Capital Letter Z"),
    e("\u{E005B}", "Tag Left Square Bracket"),
    e("\u{E005C}", "Tag Reverse Solidus"),
    e("\u{E005D}", "Tag Right Square Bracket"),
    e("\u{E005E}", "Tag Circumflex Accent"),
    e("\u{E005F}", "Tag Low Line"),
    e("\u{E0060}", "Tag Grave Accent"),
    e("\u{E0061}", "Tag Latin Small Letter a"),
    e("\u{E0062}", "Tag Latin Small Letter B"),
    e("\u{E0063}", "Tag Latin Small Letter C"),
    e("\u{E0064}", "Tag Latin Small Letter D"),
    e("\u{E0065}", "Tag Latin Small Letter E"),
    e("\u{E0066}", "Tag Latin Small Letter F"),
    e("\u{E0067}", "Tag Latin Small Letter G"),
    e("\u{E0068}", "Tag Latin Small Letter H"),
    e("\u{E0069}", "Tag Latin Small Letter I"),
    e("\u{E006A}", "Tag Latin Small Letter J"),
    e("\u{E006B}", "Tag Latin Small Letter K"),
    e("\u{E006C}", "Tag Latin Small Letter L"),
    e("\u{E006D}", "Tag Latin Small Letter M"),
    e("\u{E006E}", "Tag Latin Small Letter N"),
    e("\u{E006F}", "Tag Latin Small Letter O"),
    e("\u{E0070}", "Tag Latin Small Letter P"),
    e("\u{E0071}", "Tag Latin Small Letter Q"),
    e("\u{E0072}", "Tag Latin Small Letter R"),
    e("\u{E0073}", "Tag Latin Small Letter S"),
    e("\u{E0074}", "Tag Latin Small Letter T"),
    e("\u{E0075}", "Tag Latin Small Letter U"),
    e("\u{E0076}", "Tag Latin Small Letter V"),
    e("\u{E0077}", "Tag Latin Small Letter W"),
    e("\u{E0078}", "Tag Latin Small Letter X"),
    e("\u{E0079}", "Tag Latin Small Letter Y"),
    e("\u{E007A}", "Tag Latin Small Letter Z"),
    e("\u{E007B}", "Tag Left Curly Bracket"),
    e("\u{E007C}", "Tag Vertical Line"),
    e("\u{E007D}", "Tag Right Curly Bracket"),
    e("\u{E007E}", "Tag Tilde"),
    e("\u{E007F}", "Cancel Tag"));

const math = g(
    "Math", "Math",
    e("\u{2716}\u{FE0F}", "Multiply"),
    e("\u{2795}", "Plus"),
    e("\u{2796}", "Minus"),
    e("\u{2797}", "Divide"));

const games = g(
    "Games", "Games",
    e("\u{2660}\u{FE0F}", "Spade Suit"),
    e("\u{2663}\u{FE0F}", "Club Suit"),
    e("\u{2665}\u{FE0F}", "Heart Suit", { color: "red" }),
    e("\u{2666}\u{FE0F}", "Diamond Suit", { color: "red" }),
    e("\u{1F004}", "Mahjong Red Dragon"),
    e("\u{1F0CF}", "Joker"),
    e("\u{1F3AF}", "Direct Hit"),
    e("\u{1F3B0}", "Slot Machine"),
    e("\u{1F3B1}", "Pool 8 Ball"),
    e("\u{1F3B2}", "Game Die"),
    e("\u{1F3B3}", "Bowling"),
    e("\u{1F3B4}", "Flower Playing Cards"),
    e("\u{1F9E9}", "Puzzle Piece"),
    e("\u{265F}\u{FE0F}", "Chess Pawn"),
    e("\u{1FA80}", "Yo-Yo"),
    //e("\u{1FA83}", "Boomerang"),
    //e("\u{1FA86}", "Nesting Dolls"),
    e("\u{1FA81}", "Kite"));

const sportsEquipment = g(
    "Sports Equipment", "Sports equipment",
    e("\u{1F3BD}", "Running Shirt"),
    e("\u{1F3BE}", "Tennis"),
    e("\u{1F3BF}", "Skis"),
    e("\u{1F3C0}", "Basketball"),
    e("\u{1F3C5}", "Sports Medal"),
    e("\u{1F3C6}", "Trophy"),
    e("\u{1F3C8}", "American Football"),
    e("\u{1F3C9}", "Rugby Football"),
    e("\u{1F3CF}", "Cricket Game"),
    e("\u{1F3D0}", "Volleyball"),
    e("\u{1F3D1}", "Field Hockey"),
    e("\u{1F3D2}", "Ice Hockey"),
    e("\u{1F3D3}", "Ping Pong"),
    e("\u{1F3F8}", "Badminton"),
    e("\u{1F6F7}", "Sled"),
    e("\u{1F945}", "Goal Net"),
    e("\u{1F947}", "1st Place Medal"),
    e("\u{1F948}", "2nd Place Medal"),
    e("\u{1F949}", "3rd Place Medal"),
    e("\u{1F94A}", "Boxing Glove"),
    e("\u{1F94C}", "Curling Stone"),
    e("\u{1F94D}", "Lacrosse"),
    e("\u{1F94E}", "Softball"),
    e("\u{1F94F}", "Flying Disc"),
    e("\u{26BD}", "Soccer Ball"),
    e("\u{26BE}", "Baseball"),
    e("\u{26F8}\u{FE0F}", "Ice Skate"));

const clothing = g(
    "Clothing", "Clothing",
    e("\u{1F3A9}", "Top Hat"),
    e("\u{1F93F}", "Diving Mask"),
    e("\u{1F452}", "Woman’s Hat"),
    e("\u{1F453}", "Glasses"),
    e("\u{1F576}\u{FE0F}", "Sunglasses"),
    e("\u{1F454}", "Necktie"),
    e("\u{1F455}", "T-Shirt"),
    e("\u{1F456}", "Jeans"),
    e("\u{1F457}", "Dress"),
    e("\u{1F458}", "Kimono"),
    e("\u{1F459}", "Bikini"),
    e("\u{1F45A}", "Woman’s Clothes"),
    e("\u{1F45B}", "Purse"),
    e("\u{1F45C}", "Handbag"),
    e("\u{1F45D}", "Clutch Bag"),
    e("\u{1F45E}", "Man’s Shoe"),
    e("\u{1F45F}", "Running Shoe"),
    e("\u{1F460}", "High-Heeled Shoe"),
    e("\u{1F461}", "Woman’s Sandal"),
    e("\u{1F462}", "Woman’s Boot"),
    e("\u{1F94B}", "Martial Arts Uniform"),
    e("\u{1F97B}", "Sari"),
    e("\u{1F97C}", "Lab Coat"),
    e("\u{1F97D}", "Goggles"),
    e("\u{1F97E}", "Hiking Boot"),
    e("\u{1F97F}", "Flat Shoe"),
    whiteCane,
    e("\u{1F9BA}", "Safety Vest"),
    e("\u{1F9E2}", "Billed Cap"),
    e("\u{1F9E3}", "Scarf"),
    e("\u{1F9E4}", "Gloves"),
    e("\u{1F9E5}", "Coat"),
    e("\u{1F9E6}", "Socks"),
    e("\u{1F9FF}", "Nazar Amulet"),
    e("\u{1FA70}", "Ballet Shoes"),
    e("\u{1FA71}", "One-Piece Swimsuit"),
    e("\u{1FA72}", "Briefs"),
    e("\u{1FA73}", "Shorts"));

const town = g(
    "Town", "Town",
    e("\u{1F3D7}\u{FE0F}", "Building Construction"),
    e("\u{1F3D8}\u{FE0F}", "Houses"),
    e("\u{1F3D9}\u{FE0F}", "Cityscape"),
    e("\u{1F3DA}\u{FE0F}", "Derelict House"),
    e("\u{1F3DB}\u{FE0F}", "Classical Building"),
    e("\u{1F3DC}\u{FE0F}", "Desert"),
    e("\u{1F3DD}\u{FE0F}", "Desert Island"),
    e("\u{1F3DE}\u{FE0F}", "National Park"),
    e("\u{1F3DF}\u{FE0F}", "Stadium"),
    e("\u{1F3E0}", "House"),
    e("\u{1F3E1}", "House with Garden"),
    e("\u{1F3E2}", "Office Building"),
    e("\u{1F3E3}", "Japanese Post Office"),
    e("\u{1F3E4}", "Post Office"),
    e("\u{1F3E5}", "Hospital"),
    e("\u{1F3E6}", "Bank"),
    e("\u{1F3E7}", "ATM Sign"),
    e("\u{1F3E8}", "Hotel"),
    e("\u{1F3E9}", "Love Hotel"),
    e("\u{1F3EA}", "Convenience Store"),
    school,
    e("\u{1F3EC}", "Department Store"),
    factory,
    e("\u{1F309}", "Bridge at Night"),
    e("\u{26F2}", "Fountain"),
    e("\u{1F6CD}\u{FE0F}", "Shopping Bags"),
    e("\u{1F9FE}", "Receipt"),
    e("\u{1F6D2}", "Shopping Cart"),
    e("\u{1F488}", "Barber Pole"),
    e("\u{1F492}", "Wedding"),
    e("\u{1F5F3}\u{FE0F}", "Ballot Box with Ballot"));

const music = g(
    "Music", "Music",
    e("\u{1F3BC}", "Musical Score"),
    e("\u{1F3B6}", "Musical Notes"),
    e("\u{1F3B5}", "Musical Note"),
    e("\u{1F3B7}", "Saxophone"),
    e("\u{1F3B8}", "Guitar"),
    e("\u{1F3B9}", "Musical Keyboard"),
    e("\u{1F3BA}", "Trumpet"),
    e("\u{1F3BB}", "Violin"),
    e("\u{1F941}", "Drum"),
    //e("\u{1FA97}", "Accordion"),
    //e("\u{1FA98}", "Long Drum"),
    e("\u{1FA95}", "Banjo"));

const weather = g(
    "Weather", "Weather",
    e("\u{1F304}", "Sunrise Over Mountains"),
    e("\u{1F305}", "Sunrise"),
    e("\u{1F306}", "Cityscape at Dusk"),
    e("\u{1F307}", "Sunset"),
    e("\u{1F303}", "Night with Stars"),
    e("\u{1F302}", "Closed Umbrella"),
    e("\u{2602}\u{FE0F}", "Umbrella"),
    e("\u{2614}\u{FE0F}", "Umbrella with Rain Drops"),
    e("\u{2603}\u{FE0F}", "Snowman"),
    e("\u{26C4}", "Snowman Without Snow"),
    e("\u{2600}\u{FE0F}", "Sun"),
    e("\u{2601}\u{FE0F}", "Cloud"),
    e("\u{1F324}\u{FE0F}", "Sun Behind Small Cloud"),
    e("\u{26C5}", "Sun Behind Cloud"),
    e("\u{1F325}\u{FE0F}", "Sun Behind Large Cloud"),
    e("\u{1F326}\u{FE0F}", "Sun Behind Rain Cloud"),
    e("\u{1F327}\u{FE0F}", "Cloud with Rain"),
    e("\u{1F328}\u{FE0F}", "Cloud with Snow"),
    e("\u{1F329}\u{FE0F}", "Cloud with Lightning"),
    e("\u{26C8}\u{FE0F}", "Cloud with Lightning and Rain"),
    e("\u{2744}\u{FE0F}", "Snowflake"),
    e("\u{1F300}", "Cyclone"),
    e("\u{1F32A}\u{FE0F}", "Tornado"),
    e("\u{1F32C}\u{FE0F}", "Wind Face"),
    e("\u{1F30A}", "Water Wave"),
    e("\u{1F32B}\u{FE0F}", "Fog"),
    e("\u{1F301}", "Foggy"),
    e("\u{1F308}", "Rainbow"),
    e("\u{1F321}\u{FE0F}", "Thermometer"));

const astro = g(
    "Astronomy", "Astronomy",
    e("\u{1F30C}", "Milky Way"),
    e("\u{1F30D}", "Globe Showing Europe-Africa"),
    e("\u{1F30E}", "Globe Showing Americas"),
    e("\u{1F30F}", "Globe Showing Asia-Australia"),
    e("\u{1F310}", "Globe with Meridians"),
    e("\u{1F311}", "New Moon"),
    e("\u{1F312}", "Waxing Crescent Moon"),
    e("\u{1F313}", "First Quarter Moon"),
    e("\u{1F314}", "Waxing Gibbous Moon"),
    e("\u{1F315}", "Full Moon"),
    e("\u{1F316}", "Waning Gibbous Moon"),
    e("\u{1F317}", "Last Quarter Moon"),
    e("\u{1F318}", "Waning Crescent Moon"),
    e("\u{1F319}", "Crescent Moon"),
    e("\u{1F31A}", "New Moon Face"),
    e("\u{1F31B}", "First Quarter Moon Face"),
    e("\u{1F31C}", "Last Quarter Moon Face"),
    e("\u{1F31D}", "Full Moon Face"),
    e("\u{1F31E}", "Sun with Face"),
    e("\u{1F31F}", "Glowing Star"),
    e("\u{1F320}", "Shooting Star"),
    e("\u{2604}\u{FE0F}", "Comet"),
    e("\u{1FA90}", "Ringed Planet"));

const finance = g(
    "Finance", "Finance",
    e("\u{1F4B0}", "Money Bag"),
    e("\u{1F4B1}", "Currency Exchange"),
    e("\u{1F4B2}", "Heavy Dollar Sign"),
    e("\u{1F4B3}", "Credit Card"),
    e("\u{1F4B4}", "Yen Banknote"),
    e("\u{1F4B5}", "Dollar Banknote"),
    e("\u{1F4B6}", "Euro Banknote"),
    e("\u{1F4B7}", "Pound Banknote"),
    e("\u{1F4B8}", "Money with Wings"),
    //e("\u{1FA99}", "Coin"),
    e("\u{1F4B9}", "Chart Increasing with Yen"));

const writing = g(
    "Writing", "Writing",
    e("\u{1F58A}\u{FE0F}", "Pen"),
    e("\u{1F58B}\u{FE0F}", "Fountain Pen"),
    e("\u{1F58C}\u{FE0F}", "Paintbrush"),
    e("\u{1F58D}\u{FE0F}", "Crayon"),
    e("\u{270F}\u{FE0F}", "Pencil"),
    e("\u{2712}\u{FE0F}", "Black Nib"));

const alembic = e("\u{2697}\u{FE0F}", "Alembic");
const gear = e("\u{2699}\u{FE0F}", "Gear");
const atomSymbol = e("\u{269B}\u{FE0F}", "Atom Symbol");
const keyboard = e("\u{2328}\u{FE0F}", "Keyboard");
const telephone = e("\u{260E}\u{FE0F}", "Telephone");
const studioMicrophone = e("\u{1F399}\u{FE0F}", "Studio Microphone");
const levelSlider = e("\u{1F39A}\u{FE0F}", "Level Slider");
const controlKnobs = e("\u{1F39B}\u{FE0F}", "Control Knobs");
const movieCamera = e("\u{1F3A5}", "Movie Camera");
const headphone = e("\u{1F3A7}", "Headphone");
const videoGame = e("\u{1F3AE}", "Video Game");
const lightBulb = e("\u{1F4A1}", "Light Bulb");
const computerDisk = e("\u{1F4BD}", "Computer Disk");
const floppyDisk = e("\u{1F4BE}", "Floppy Disk");
const opticalDisk = e("\u{1F4BF}", "Optical Disk");
const dvd = e("\u{1F4C0}", "DVD");
const telephoneReceiver = e("\u{1F4DE}", "Telephone Receiver");
const pager = e("\u{1F4DF}", "Pager");
const faxMachine = e("\u{1F4E0}", "Fax Machine");
const satelliteAntenna = e("\u{1F4E1}", "Satellite Antenna");
const loudspeaker = e("\u{1F4E2}", "Loudspeaker");
const megaphone = e("\u{1F4E3}", "Megaphone");
const mobilePhone = e("\u{1F4F1}", "Mobile Phone");
const mobilePhoneWithArrow = e("\u{1F4F2}", "Mobile Phone with Arrow");
const mobilePhoneVibrating = e("\u{1F4F3}", "Mobile Phone Vibrating");
const mobilePhoneOff = e("\u{1F4F4}", "Mobile Phone Off");
const noMobilePhone = e("\u{1F4F5}", "No Mobile Phone");
const antennaBars = e("\u{1F4F6}", "Antenna Bars");
const camera = e("\u{1F4F7}", "Camera");
const cameraWithFlash = e("\u{1F4F8}", "Camera with Flash");
const videoCamera = e("\u{1F4F9}", "Video Camera");
const television = e("\u{1F4FA}", "Television");
const radio = e("\u{1F4FB}", "Radio");
const videocassette = e("\u{1F4FC}", "Videocassette");
const filmProjector = e("\u{1F4FD}\u{FE0F}", "Film Projector");
const portableStereo = e("\u{1F4FE}\u{FE0F}", "Portable Stereo");
const dimButton = e("\u{1F505}", "Dim Button");
const brightButton = e("\u{1F506}", "Bright Button");
const mutedSpeaker = e("\u{1F507}", "Muted Speaker");
const speakerLowVolume = e("\u{1F508}", "Speaker Low Volume");
const speakerMediumVolume = e("\u{1F509}", "Speaker Medium Volume");
const speakerHighVolume = e("\u{1F50A}", "Speaker High Volume");
const battery = e("\u{1F50B}", "Battery");
const electricPlug = e("\u{1F50C}", "Electric Plug");
const magnifyingGlassTiltedLeft = e("\u{1F50D}", "Magnifying Glass Tilted Left");
const magnifyingGlassTiltedRight = e("\u{1F50E}", "Magnifying Glass Tilted Right");
const lockedWithPen = e("\u{1F50F}", "Locked with Pen");
const lockedWithKey = e("\u{1F510}", "Locked with Key");
const key = e("\u{1F511}", "Key");
const locked = e("\u{1F512}", "Locked");
const unlocked = e("\u{1F513}", "Unlocked");
const bell = e("\u{1F514}", "Bell");
const bellWithSlash = e("\u{1F515}", "Bell with Slash");
const bookmark = e("\u{1F516}", "Bookmark");
const link = e("\u{1F517}", "Link");
const joystick = e("\u{1F579}\u{FE0F}", "Joystick");
const desktopComputer = e("\u{1F5A5}\u{FE0F}", "Desktop Computer");
const printer = e("\u{1F5A8}\u{FE0F}", "Printer");
const computerMouse = e("\u{1F5B1}\u{FE0F}", "Computer Mouse");
const trackball = e("\u{1F5B2}\u{FE0F}", "Trackball");
const blackFolder = e("\u{1F5BF}", "Black Folder");
const folder = e("\u{1F5C0}", "Folder");
const openFolder = e("\u{1F5C1}", "Open Folder");
const cardIndexDividers = e("\u{1F5C2}", "Card Index Dividers");
const cardFileBox = e("\u{1F5C3}", "Card File Box");
const fileCabinet = e("\u{1F5C4}", "File Cabinet");
const emptyNote = e("\u{1F5C5}", "Empty Note");
const emptyNotePage = e("\u{1F5C6}", "Empty Note Page");
const emptyNotePad = e("\u{1F5C7}", "Empty Note Pad");
const note = e("\u{1F5C8}", "Note");
const notePage = e("\u{1F5C9}", "Note Page");
const notePad = e("\u{1F5CA}", "Note Pad");
const emptyDocument = e("\u{1F5CB}", "Empty Document");
const emptyPage = e("\u{1F5CC}", "Empty Page");
const emptyPages = e("\u{1F5CD}", "Empty Pages");
const documentIcon = e("\u{1F5CE}", "Document");
const page = e("\u{1F5CF}", "Page");
const pages = e("\u{1F5D0}", "Pages");
const wastebasket = e("\u{1F5D1}", "Wastebasket");
const spiralNotePad = e("\u{1F5D2}", "Spiral Note Pad");
const spiralCalendar = e("\u{1F5D3}", "Spiral Calendar");
const desktopWindow = e("\u{1F5D4}", "Desktop Window");
const minimize = e("\u{1F5D5}", "Minimize");
const maximize = e("\u{1F5D6}", "Maximize");
const overlap = e("\u{1F5D7}", "Overlap");
const reload = e("\u{1F5D8}", "Reload");
const close = e("\u{1F5D9}", "Close");
const increaseFontSize = e("\u{1F5DA}", "Increase Font Size");
const decreaseFontSize = e("\u{1F5DB}", "Decrease Font Size");
const compression = e("\u{1F5DC}", "Compression");
const oldKey = e("\u{1F5DD}", "Old Key");
const tech = g(
    "Technology", "Technology",
    joystick,
    videoGame,
    lightBulb,
    laptop,
    briefcase,
    computerDisk,
    floppyDisk,
    opticalDisk,
    dvd,
    desktopComputer,
    keyboard,
    printer,
    computerMouse,
    trackball,
    telephone,
    telephoneReceiver,
    pager,
    faxMachine,
    satelliteAntenna,
    loudspeaker,
    megaphone,
    television,
    radio,
    videocassette,
    filmProjector,
    studioMicrophone,
    levelSlider,
    controlKnobs,
    microphone,
    movieCamera,
    headphone,
    camera,
    cameraWithFlash,
    videoCamera,
    mobilePhone,
    mobilePhoneOff,
    mobilePhoneWithArrow,
    lockedWithPen,
    lockedWithKey,
    locked,
    unlocked,
    bell,
    bellWithSlash,
    bookmark,
    link,
    mobilePhoneVibrating,
    antennaBars,
    dimButton,
    brightButton,
    mutedSpeaker,
    speakerLowVolume,
    speakerMediumVolume,
    speakerHighVolume,
    battery,
    electricPlug);

const mail = g(
    "Mail", "Mail",
    e("\u{1F4E4}", "Outbox Tray"),
    e("\u{1F4E5}", "Inbox Tray"),
    e("\u{1F4E6}", "Package"),
    e("\u{1F4E7}", "E-Mail"),
    e("\u{1F4E8}", "Incoming Envelope"),
    e("\u{1F4E9}", "Envelope with Arrow"),
    e("\u{1F4EA}", "Closed Mailbox with Lowered Flag"),
    e("\u{1F4EB}", "Closed Mailbox with Raised Flag"),
    e("\u{1F4EC}", "Open Mailbox with Raised Flag"),
    e("\u{1F4ED}", "Open Mailbox with Lowered Flag"),
    e("\u{1F4EE}", "Postbox"),
    e("\u{1F4EF}", "Postal Horn"));

const celebration = g(
    "Celebration", "Celebration",
    e("\u{1F380}", "Ribbon"),
    e("\u{1F381}", "Wrapped Gift"),
    e("\u{1F383}", "Jack-O-Lantern"),
    e("\u{1F384}", "Christmas Tree"),
    e("\u{1F9E8}", "Firecracker"),
    e("\u{1F386}", "Fireworks"),
    e("\u{1F387}", "Sparkler"),
    e("\u{2728}", "Sparkles"),
    e("\u{2747}\u{FE0F}", "Sparkle"),
    e("\u{1F388}", "Balloon"),
    e("\u{1F389}", "Party Popper"),
    e("\u{1F38A}", "Confetti Ball"),
    e("\u{1F38B}", "Tanabata Tree"),
    e("\u{1F38D}", "Pine Decoration"),
    e("\u{1F38E}", "Japanese Dolls"),
    e("\u{1F38F}", "Carp Streamer"),
    e("\u{1F390}", "Wind Chime"),
    e("\u{1F391}", "Moon Viewing Ceremony"),
    e("\u{1F392}", "Backpack"),
    graduationCap,
    e("\u{1F9E7}", "Red Envelope"),
    e("\u{1F3EE}", "Red Paper Lantern"),
    e("\u{1F396}\u{FE0F}", "Military Medal"));

const tools = g(
    "Tools", "Tools",
    e("\u{1F3A3}", "Fishing Pole"),
    e("\u{1F526}", "Flashlight"),
    wrench,
    e("\u{1F528}", "Hammer"),
    e("\u{1F529}", "Nut and Bolt"),
    e("\u{1F6E0}\u{FE0F}", "Hammer and Wrench"),
    e("\u{1F9ED}", "Compass"),
    e("\u{1F9EF}", "Fire Extinguisher"),
    e("\u{1F9F0}", "Toolbox"),
    e("\u{1F9F1}", "Brick"),
    e("\u{1FA93}", "Axe"),
    e("\u{2692}\u{FE0F}", "Hammer and Pick"),
    e("\u{26CF}\u{FE0F}", "Pick"),
    e("\u{26D1}\u{FE0F}", "Rescue Worker’s Helmet"),
    e("\u{26D3}\u{FE0F}", "Chains"),
    compression);

const office = g(
    "Office", "Office",
    e("\u{1F4C1}", "File Folder"),
    e("\u{1F4C2}", "Open File Folder"),
    e("\u{1F4C3}", "Page with Curl"),
    e("\u{1F4C4}", "Page Facing Up"),
    e("\u{1F4C5}", "Calendar"),
    e("\u{1F4C6}", "Tear-Off Calendar"),
    e("\u{1F4C7}", "Card Index"),
    cardIndexDividers,
    cardFileBox,
    fileCabinet,
    wastebasket,
    spiralNotePad,
    spiralCalendar,
    e("\u{1F4C8}", "Chart Increasing"),
    e("\u{1F4C9}", "Chart Decreasing"),
    e("\u{1F4CA}", "Bar Chart"),
    e("\u{1F4CB}", "Clipboard"),
    e("\u{1F4CC}", "Pushpin"),
    e("\u{1F4CD}", "Round Pushpin"),
    e("\u{1F4CE}", "Paperclip"),
    e("\u{1F587}\u{FE0F}", "Linked Paperclips"),
    e("\u{1F4CF}", "Straight Ruler"),
    e("\u{1F4D0}", "Triangular Ruler"),
    e("\u{1F4D1}", "Bookmark Tabs"),
    e("\u{1F4D2}", "Ledger"),
    e("\u{1F4D3}", "Notebook"),
    e("\u{1F4D4}", "Notebook with Decorative Cover"),
    e("\u{1F4D5}", "Closed Book"),
    e("\u{1F4D6}", "Open Book"),
    e("\u{1F4D7}", "Green Book"),
    e("\u{1F4D8}", "Blue Book"),
    e("\u{1F4D9}", "Orange Book"),
    e("\u{1F4DA}", "Books"),
    e("\u{1F4DB}", "Name Badge"),
    e("\u{1F4DC}", "Scroll"),
    e("\u{1F4DD}", "Memo"),
    e("\u{2702}\u{FE0F}", "Scissors"),
    e("\u{2709}\u{FE0F}", "Envelope"));

const signs = g(
    "Signs", "Signs",
    e("\u{1F3A6}", "Cinema"),
    noMobilePhone,
    e("\u{1F51E}", "No One Under Eighteen"),
    e("\u{1F6AB}", "Prohibited"),
    e("\u{1F6AC}", "Cigarette"),
    e("\u{1F6AD}", "No Smoking"),
    e("\u{1F6AE}", "Litter in Bin Sign"),
    e("\u{1F6AF}", "No Littering"),
    e("\u{1F6B0}", "Potable Water"),
    e("\u{1F6B1}", "Non-Potable Water"),
    e("\u{1F6B3}", "No Bicycles"),
    e("\u{1F6B7}", "No Pedestrians"),
    e("\u{1F6B8}", "Children Crossing"),
    e("\u{1F6B9}", "Men’s Room"),
    e("\u{1F6BA}", "Women’s Room"),
    e("\u{1F6BB}", "Restroom"),
    e("\u{1F6BC}", "Baby Symbol"),
    e("\u{1F6BE}", "Water Closet"),
    e("\u{1F6C2}", "Passport Control"),
    e("\u{1F6C3}", "Customs"),
    e("\u{1F6C4}", "Baggage Claim"),
    e("\u{1F6C5}", "Left Luggage"),
    e("\u{1F17F}\u{FE0F}", "Parking Button"),
    e("\u{267F}", "Wheelchair Symbol"),
    e("\u{2622}\u{FE0F}", "Radioactive"),
    e("\u{2623}\u{FE0F}", "Biohazard"),
    e("\u{26A0}\u{FE0F}", "Warning"),
    e("\u{26A1}", "High Voltage"),
    e("\u{26D4}", "No Entry"),
    e("\u{267B}\u{FE0F}", "Recycling Symbol"),
    female,
    male,
    e("\u{26A7}\u{FE0F}", "Transgender Symbol"));

const religion = g(
    "Religion", "Religion",
    e("\u{1F52F}", "Dotted Six-Pointed Star"),
    e("\u{2721}\u{FE0F}", "Star of David"),
    e("\u{1F549}\u{FE0F}", "Om"),
    e("\u{1F54B}", "Kaaba"),
    e("\u{1F54C}", "Mosque"),
    e("\u{1F54D}", "Synagogue"),
    e("\u{1F54E}", "Menorah"),
    e("\u{1F6D0}", "Place of Worship"),
    e("\u{1F6D5}", "Hindu Temple"),
    e("\u{2626}\u{FE0F}", "Orthodox Cross"),
    e("\u{271D}\u{FE0F}", "Latin Cross"),
    e("\u{262A}\u{FE0F}", "Star and Crescent"),
    e("\u{262E}\u{FE0F}", "Peace Symbol"),
    e("\u{262F}\u{FE0F}", "Yin Yang"),
    e("\u{2638}\u{FE0F}", "Wheel of Dharma"),
    e("\u{267E}\u{FE0F}", "Infinity"),
    e("\u{1FA94}", "Diya Lamp"),
    e("\u{26E9}\u{FE0F}", "Shinto Shrine"),
    e("\u{26EA}", "Church"),
    e("\u{2734}\u{FE0F}", "Eight-Pointed Star"),
    e("\u{1F4FF}", "Prayer Beads"));

const door = e("\u{1F6AA}", "Door");
const household = g(
    "Household", "Household",
    e("\u{1F484}", "Lipstick"),
    e("\u{1F48D}", "Ring"),
    e("\u{1F48E}", "Gem Stone"),
    e("\u{1F4F0}", "Newspaper"),
    key,
    e("\u{1F525}", "Fire"),
    e("\u{1F52B}", "Pistol"),
    e("\u{1F56F}\u{FE0F}", "Candle"),
    e("\u{1F5BC}\u{FE0F}", "Framed Picture"),
    oldKey,
    e("\u{1F5DE}\u{FE0F}", "Rolled-Up Newspaper"),
    e("\u{1F5FA}\u{FE0F}", "World Map"),
    door,
    e("\u{1F6BD}", "Toilet"),
    e("\u{1F6BF}", "Shower"),
    e("\u{1F6C1}", "Bathtub"),
    e("\u{1F6CB}\u{FE0F}", "Couch and Lamp"),
    e("\u{1F6CF}\u{FE0F}", "Bed"),
    e("\u{1F9F4}", "Lotion Bottle"),
    e("\u{1F9F5}", "Thread"),
    e("\u{1F9F6}", "Yarn"),
    e("\u{1F9F7}", "Safety Pin"),
    e("\u{1F9F8}", "Teddy Bear"),
    e("\u{1F9F9}", "Broom"),
    e("\u{1F9FA}", "Basket"),
    e("\u{1F9FB}", "Roll of Paper"),
    e("\u{1F9FC}", "Soap"),
    e("\u{1F9FD}", "Sponge"),
    e("\u{1FA91}", "Chair"),
    e("\u{1FA92}", "Razor"),
    e("\u{1F397}\u{FE0F}", "Reminder Ribbon"));

const activities = g(
    "Activities", "Activities",
    e("\u{1F39E}\u{FE0F}", "Film Frames"),
    e("\u{1F39F}\u{FE0F}", "Admission Tickets"),
    e("\u{1F3A0}", "Carousel Horse"),
    e("\u{1F3A1}", "Ferris Wheel"),
    e("\u{1F3A2}", "Roller Coaster"),
    artistPalette,
    e("\u{1F3AA}", "Circus Tent"),
    e("\u{1F3AB}", "Ticket"),
    e("\u{1F3AC}", "Clapper Board"),
    e("\u{1F3AD}", "Performing Arts"));

const travel = g(
    "Travel", "Travel",
    e("\u{1F3F7}\u{FE0F}", "Label"),
    e("\u{1F30B}", "Volcano"),
    e("\u{1F3D4}\u{FE0F}", "Snow-Capped Mountain"),
    e("\u{26F0}\u{FE0F}", "Mountain"),
    e("\u{1F3D5}\u{FE0F}", "Camping"),
    e("\u{1F3D6}\u{FE0F}", "Beach with Umbrella"),
    e("\u{26F1}\u{FE0F}", "Umbrella on Ground"),
    e("\u{1F3EF}", "Japanese Castle"),
    e("\u{1F463}", "Footprints"),
    e("\u{1F5FB}", "Mount Fuji"),
    e("\u{1F5FC}", "Tokyo Tower"),
    e("\u{1F5FD}", "Statue of Liberty"),
    e("\u{1F5FE}", "Map of Japan"),
    e("\u{1F5FF}", "Moai"),
    e("\u{1F6CE}\u{FE0F}", "Bellhop Bell"),
    e("\u{1F9F3}", "Luggage"),
    e("\u{26F3}", "Flag in Hole"),
    e("\u{26FA}", "Tent"),
    e("\u{2668}\u{FE0F}", "Hot Springs"));

const medieval = g(
    "Medieval", "Medieval",
    e("\u{1F3F0}", "Castle"),
    e("\u{1F3F9}", "Bow and Arrow"),
    crown,
    e("\u{1F531}", "Trident Emblem"),
    e("\u{1F5E1}\u{FE0F}", "Dagger"),
    e("\u{1F6E1}\u{FE0F}", "Shield"),
    e("\u{1F52E}", "Crystal Ball"),
    e("\u{2694}\u{FE0F}", "Crossed Swords"),
    e("\u{269C}\u{FE0F}", "Fleur-de-lis"));

const doubleExclamationMark = e("\u{203C}\u{FE0F}", "Double Exclamation Mark");
const interrobang = e("\u{2049}\u{FE0F}", "Exclamation Question Mark");
const information = e("\u{2139}\u{FE0F}", "Information");
const circledM = e("\u{24C2}\u{FE0F}", "Circled M");
const checkMarkButton = e("\u{2705}", "Check Mark Button");
const checkMark = e("\u{2714}\u{FE0F}", "Check Mark");
const eightSpokedAsterisk = e("\u{2733}\u{FE0F}", "Eight-Spoked Asterisk");
const crossMark = e("\u{274C}", "Cross Mark");
const crossMarkButton = e("\u{274E}", "Cross Mark Button");
const questionMark = e("\u{2753}", "Question Mark");
const whiteQuestionMark = e("\u{2754}", "White Question Mark");
const whiteExclamationMark = e("\u{2755}", "White Exclamation Mark");
const exclamationMark = e("\u{2757}", "Exclamation Mark");
const curlyLoop = e("\u{27B0}", "Curly Loop");
const doubleCurlyLoop = e("\u{27BF}", "Double Curly Loop");
const wavyDash = e("\u{3030}\u{FE0F}", "Wavy Dash");
const partAlternationMark = e("\u{303D}\u{FE0F}", "Part Alternation Mark");
const tradeMark = e("\u{2122}\u{FE0F}", "Trade Mark");
const copyright = e("\u{A9}\u{FE0F}", "Copyright");
const registered = e("\u{AE}\u{FE0F}", "Registered");
const squareFourCourners = e("\u{26F6}\u{FE0F}", "Square: Four Corners");

const marks = gg(
    "Marks", "Marks", {
    doubleExclamationMark,
    interrobang,
    information,
    circledM,
    checkMarkButton,
    checkMark,
    eightSpokedAsterisk,
    crossMark,
    crossMarkButton,
    questionMark,
    whiteQuestionMark,
    whiteExclamationMark,
    exclamationMark,
    curlyLoop,
    doubleCurlyLoop,
    wavyDash,
    partAlternationMark,
    tradeMark,
    copyright,
    registered,
});

const droplet = e("\u{1F4A7}", "Droplet");
const dropOfBlood = e("\u{1FA78}", "Drop of Blood");
const adhesiveBandage = e("\u{1FA79}", "Adhesive Bandage");
const stethoscope = e("\u{1FA7A}", "Stethoscope");
const syringe = e("\u{1F489}", "Syringe");
const pill = e("\u{1F48A}", "Pill");
const testTube = e("\u{1F9EA}", "Test Tube");
const petriDish = e("\u{1F9EB}", "Petri Dish");
const dna = e("\u{1F9EC}", "DNA");
const abacus = e("\u{1F9EE}", "Abacus");
const magnet = e("\u{1F9F2}", "Magnet");
const telescope = e("\u{1F52D}", "Telescope");

const science = gg(
    "Science", "Science", {
    droplet,
    dropOfBlood,
    adhesiveBandage,
    stethoscope,
    syringe,
    pill,
    microscope,
    testTube,
    petriDish,
    dna,
    abacus,
    magnet,
    telescope,
    medical,
    balanceScale,
    alembic,
    gear,
    atomSymbol,
    magnifyingGlassTiltedLeft,
    magnifyingGlassTiltedRight,
});
const whiteChessKing = e("\u{2654}", "White Chess King");
const whiteChessQueen = e("\u{2655}", "White Chess Queen");
const whiteChessRook = e("\u{2656}", "White Chess Rook");
const whiteChessBishop = e("\u{2657}", "White Chess Bishop");
const whiteChessKnight = e("\u{2658}", "White Chess Knight");
const whiteChessPawn = e("\u{2659}", "White Chess Pawn");
const whiteChessPieces = gg(whiteChessKing.value + whiteChessQueen.value + whiteChessRook.value + whiteChessBishop.value + whiteChessKnight.value + whiteChessPawn.value, "White Chess Pieces", {
    width: "auto",
    king: whiteChessKing,
    queen: whiteChessQueen,
    rook: whiteChessRook,
    bishop: whiteChessBishop,
    knight: whiteChessKnight,
    pawn: whiteChessPawn
});
const blackChessKing = e("\u{265A}", "Black Chess King");
const blackChessQueen = e("\u{265B}", "Black Chess Queen");
const blackChessRook = e("\u{265C}", "Black Chess Rook");
const blackChessBishop = e("\u{265D}", "Black Chess Bishop");
const blackChessKnight = e("\u{265E}", "Black Chess Knight");
const blackChessPawn = e("\u{265F}", "Black Chess Pawn");
const blackChessPieces = gg(blackChessKing.value + blackChessQueen.value + blackChessRook.value + blackChessBishop.value + blackChessKnight.value + blackChessPawn.value, "Black Chess Pieces", {
    width: "auto",
    king: blackChessKing,
    queen: blackChessQueen,
    rook: blackChessRook,
    bishop: blackChessBishop,
    knight: blackChessKnight,
    pawn: blackChessPawn
});
const chessPawns = gg(whiteChessPawn.value + blackChessPawn.value, "Chess Pawns", {
    width: "auto",
    white: whiteChessPawn,
    black: blackChessPawn
});
const chessRooks = gg(whiteChessRook.value + blackChessRook.value, "Chess Rooks", {
    width: "auto",
    white: whiteChessRook,
    black: blackChessRook
});
const chessBishops = gg(whiteChessBishop.value + blackChessBishop.value, "Chess Bishops", {
    width: "auto",
    white: whiteChessBishop,
    black: blackChessBishop
});
const chessKnights = gg(whiteChessKnight.value + blackChessKnight.value, "Chess Knights", {
    width: "auto",
    white: whiteChessKnight,
    black: blackChessKnight
});
const chessQueens = gg(whiteChessQueen.value + blackChessQueen.value, "Chess Queens", {
    width: "auto",
    white: whiteChessQueen,
    black: blackChessQueen
});
const chessKings = gg(whiteChessKing.value + blackChessKing.value, "Chess Kings", {
    width: "auto",
    white: whiteChessKing,
    black: blackChessKing
});

const chess = gg("Chess Pieces", "Chess Pieces", {
    width: "auto",
    white: whiteChessPieces,
    black: blackChessPieces,
    pawns: chessPawns,
    rooks: chessRooks,
    bishops: chessBishops,
    knights: chessKnights,
    queens: chessQueens,
    kings: chessKings
});

const dice1 = e("\u2680", "Dice: Side 1");
const dice2 = e("\u2681", "Dice: Side 2");
const dice3 = e("\u2682", "Dice: Side 3");
const dice4 = e("\u2683", "Dice: Side 4");
const dice5 = e("\u2684", "Dice: Side 5");
const dice6 = e("\u2685", "Dice: Side 6");
const dice = gg("Dice", "Dice", {
    dice1,
    dice2,
    dice3,
    dice4,
    dice5,
    dice6
});

const allIcons = gg(
    "All Icons", "All Icons", {
    faces,
    love,
    cartoon,
    hands,
    bodyParts,
    people,
    gestures: gestures$1,
    inMotion,
    resting,
    roles,
    fantasy,
    animals,
    plants,
    food,
    flags,
    vehicles,
    clocks,
    arrows,
    shapes,
    buttons,
    zodiac,
    chess,
    dice,
    math,
    games,
    sportsEquipment,
    clothing,
    town,
    music,
    weather,
    astro,
    finance,
    writing,
    science,
    tech,
    mail,
    celebration,
    tools,
    office,
    signs,
    religion,
    household,
    activities,
    travel,
    medieval
});

const DEFAULT_TEST_TEXT = "The quick brown fox jumps over the lazy dog";
const loadedFonts = [];

/**
 * 
 * @param {any} style
 * @returns {string}
 */
function makeFont(style) {
    const fontParts = [];
    if (style.fontStyle && style.fontStyle !== "normal") {
        fontParts.push(style.fontStyle);
    }

    if (style.fontVariant && style.fontVariant !== "normal") {
        fontParts.push(style.fontVariant);
    }

    if (style.fontWeight && style.fontWeight !== "normal") {
        fontParts.push(style.fontWeight);
    }

    fontParts.push(style.fontSize + "px");
    fontParts.push(style.fontFamily);

    return fontParts.join(" ");
}

/**
 * @param {string} font
 * @param {string?} testString
 */
async function loadFont(font, testString = null) {
    if (loadedFonts.indexOf(font) === -1) {
        testString = testString || DEFAULT_TEST_TEXT;
        const fonts = await document.fonts.load(font, testString);
        if (fonts.length === 0) {
            console.warn(`Failed to load font "${font}". If this is a system font, just set the object's \`value\` property, instead of calling \`loadFontAndSetText\`.`);
        }
        else {
            loadedFonts.push(font);
        }
    }
}

/**
 * A setter functor for HTML attributes.
 **/
class HtmlAttr {
    /**
     * Creates a new setter functor for HTML Attributes
     * @param {string} key - the attribute name.
     * @param {string} value - the value to set for the attribute.
     * @param {...string} tags - the HTML tags that support this attribute.
     */
    constructor(key, value, ...tags) {
        this.key = key;
        this.value = value;
        this.tags = tags.map(t => t.toLocaleUpperCase());
        Object.freeze(this);
    }

    /**
     * Set the attribute value on an HTMLElement
     * @param {HTMLElement} elem - the element on which to set the attribute.
     */
    apply(elem) {
        const isValid = this.tags.length === 0
            || this.tags.indexOf(elem.tagName) > -1;

        if (!isValid) {
            console.warn(`Element ${elem.tagName} does not support Attribute ${this.key}`);
        }
        else if (this.key === "style") {
            Object.assign(elem[this.key], this.value);
        }
        else if (!isBoolean(value)) {
            elem[this.key] = this.value;
        }
        else if (this.value) {
            elem.setAttribute(this.key, "");
        }
        else {
            elem.removeAttribute(this.key);
        }
    }
}

/**
 * Alternative text in case an image can't be displayed.
 * @param {string} value - the value to set on the attribute.
 * @returns {HtmlAttr}
 **/
function alt(value) { return new HtmlAttr("alt", value, "applet", "area", "img", "input"); }

/**
 * The audio or video should play as soon as possible.
 * @param {boolean} value - the value to set on the attribute.
 * @returns {HtmlAttr}
 **/
function autoPlay(value) { return new HtmlAttr("autoplay", value, "audio", "video"); }

/**
 * Often used with CSS to style elements with common properties.
 * @param {string} value - the value to set on the attribute.
 * @returns {HtmlAttr}
 **/
function className(value) { return new HtmlAttr("className", value); }

/**
 * Indicates whether the user can interact with the element.
 * @param {boolean} value - the value to set on the attribute.
 * @returns {HtmlAttr}
 **/
function disabled(value) { return new HtmlAttr("disabled", value, "button", "command", "fieldset", "input", "keygen", "optgroup", "option", "select", "textarea"); }

/**
 * Describes elements which belongs to this one.
 * @param {string} value - the value to set on the attribute.
 * @returns {HtmlAttr}
 **/
function htmlFor(value) { return new HtmlAttr("htmlFor", value, "label", "output"); }

/**
 * Specifies the height of elements listed here. For all other elements, use the CSS height property.
 * @param {number} value - the value to set on the attribute.
 * @returns {HtmlAttr}
 **/
function height(value) { return new HtmlAttr("height", value, "canvas", "embed", "iframe", "img", "input", "object", "video"); }

/**
 * The URL of a linked resource.
 * @param {string} value - the value to set on the attribute.
 * @returns {HtmlAttr}
 **/
function href(value) { return new HtmlAttr("href", value, "a", "area", "base", "link"); }

/**
 * Often used with CSS to style a specific element. The value of this attribute must be unique.
 * @param {string} value - the value to set on the attribute.
 * @returns {HtmlAttr}
 **/
function id(value) { return new HtmlAttr("id", value); }

/**
 * Indicates the maximum value allowed.
 * @param {number} value - the value to set on the attribute.
 * @returns {HtmlAttr}
 **/
function max(value) { return new HtmlAttr("max", value, "input", "meter", "progress"); }

/**
 * Indicates the minimum value allowed.
 * @param {number} value - the value to set on the attribute.
 * @returns {HtmlAttr}
 **/
function min(value) { return new HtmlAttr("min", value, "input", "meter"); }

/**
 * Indicates whether the audio will be initially silenced on page load.
 * @param {boolean} value - the value to set on the attribute.
 * @returns {HtmlAttr}
 **/
function muted(value) { return new HtmlAttr("muted", value, "audio", "video"); }

/**
 * Provides a hint to the user of what can be entered in the field.
 * @param {string} value - the value to set on the attribute.
 * @returns {HtmlAttr}
 **/
function placeHolder(value) { return new HtmlAttr("placeholder", value, "input", "textarea"); }

/**
 * Indicates that the media element should play automatically on iOS.
 * @param {boolean} value - the value to set on the attribute.
 * @returns {HtmlAttr}
 **/
function playsInline(value) { return new HtmlAttr("playsInline", value, "audio", "video"); }

/**
 * Defines the number of rows in a text area.
 * @param {string} value - the value to set on the attribute.
 * @returns {HtmlAttr}
 **/
function role(value) { return new HtmlAttr("role", value); }

/**
 * The URL of the embeddable content.
 * @param {string} value - the value to set on the attribute.
 * @returns {HtmlAttr}
 **/
function src(value) { return new HtmlAttr("src", value, "audio", "embed", "iframe", "img", "input", "script", "source", "track", "video"); }

/**
 * A MediaStream object to use as a source for an HTML video or audio element
 * @param {string} value - the value to set on the attribute.
 * @returns {HtmlAttr}
 **/
function srcObject(value) { return new HtmlAttr("srcObject", value, "audio", "video"); }

/**
 * The step attribute
 * @param {number} value - the value to set on the attribute.
 * @returns {HtmlAttr}
 **/
function step(value) { return new HtmlAttr("step", value, "input"); }

/**
 * Text to be displayed in a tooltip when hovering over the element.
 * @param {string} value - the value to set on the attribute.
 * @returns {HtmlAttr}
 **/
function title(value) { return new HtmlAttr("title", value); }

/**
 * Defines the type of the element.
 * @param {string} value - the value to set on the attribute.
 * @returns {HtmlAttr}
 **/
function type(value) { return new HtmlAttr("type", value, "button", "input", "command", "embed", "object", "script", "source", "style", "menu"); }

/**
 * Defines a default value which will be displayed in the element on page load.
 * @param {string} value - the value to set on the attribute.
 * @returns {HtmlAttr}
 **/
function value(value) { return new HtmlAttr("value", value, "button", "data", "input", "li", "meter", "option", "progress", "param"); }

/**
 * setting the volume at which a media element plays.
 * @param {number} value - the value to set on the attribute.
 * @returns {HtmlAttr}
 **/
function volume(value) { return new HtmlAttr("volume", value, "audio", "video"); }

/**
 * For the elements listed here, this establishes the element's width.
 * @param {number} value - the value to set on the attribute.
 * @returns {HtmlAttr}
 **/
function width(value) { return new HtmlAttr("width", value, "canvas", "embed", "iframe", "img", "input", "object", "video"); }

function isOpen(target) {
    if (target.isOpen) {
        return target.isOpen();
    }
    else {
        return target.style.display !== "none";
    }
}

/**
 * Sets the element's style's display property to "none"
 * when `v` is false, or `displayType` when `v` is true.
 * @memberof Element
 * @param {boolean} v
 * @param {string} [displayType=""]
 */
function setOpen(target, v, displayType = "") {
    if (target.setOpen) {
        target.setOpen(v, displayType);
    }
    else if (v) {
        show(target, displayType);
    }
    else {
        hide(target);
    }
}

function updateLabel(target, open, enabledText, disabledText, bothText) {
    bothText = bothText || "";
    if (target.accessKey) {
        bothText += ` <kbd>(ALT+${target.accessKey.toUpperCase()})</kbd>`;
    }
    if (target.updateLabel) {
        target.updateLabel(open, enabledText, disabledText, bothText);
    }
    else {
        target.innerHTML = (open ? enabledText : disabledText) + bothText;
    }
}

function toggleOpen(target, displayType = "") {
    if (target.toggleOpen) {
        target.toggleOpen(displayType);
    }
    else if (isOpen(target)) {
        hide(target);
    }
    else {
        show(target);
    }
}

function show(target, displayType = "") {
    if (target.show) {
        target.show();
    }
    else {
        target.style.display = displayType;
    }
}

function hide(target) {
    if (target.hide) {
        target.hide();
    }
    else {
        target.style.display = "none";
    }
}
const disabler = disabled(true),
    enabler = disabled(false);

function setLocked(target, value) {
    if (target.setLocked) {
        target.setLocked(value);
    }
    else if (value) {
        disabler.apply(target);
    }
    else {
        enabler.apply(target);
    }
}

class TimerTickEvent extends Event {
    constructor() {
        super("tick");
        this.t = 0;
        this.dt = 0;
        this.sdt = 0;
        Object.seal(this);
    }

    /**
     * @param {TimerTickEvent} evt
     */
    copy(evt) {
        this.t = evt.t;
        this.dt = evt.dt;
        this.sdt = evt.sdt;
    }
}

class BaseTimer extends EventBase {

    /**
     * 
     * @param {number} targetFrameRate
     */
    constructor(targetFrameRate) {
        super();

        this._timer = null;
        this.targetFrameRate = targetFrameRate;

        /**
         * @param {number} t
         */
        this._onTick = (t) => {
            const tickEvt = new TimerTickEvent();
            let lt = t;
            /**
             * @param {number} t
             */
            this._onTick = (t) => {
                if (t > lt) {
                    tickEvt.t = t;
                    tickEvt.dt = t - lt;
                    tickEvt.sdt = tickEvt.dt;
                    lt = t;
                    /**
                     * @param {number} t
                     */
                    this._onTick = (t) => {
                        const dt = t - lt;
                        if (dt > 0 && dt >= this._frameTime) {
                            tickEvt.t = t;
                            tickEvt.dt = dt;
                            tickEvt.sdt = lerp(tickEvt.sdt, tickEvt.dt, 0.01);
                            lt = t;
                            this.dispatchEvent(tickEvt);
                        }
                    };
                }
            };
        };
    }

    restart() {
        this.stop();
        this.start();
    }

    get isRunning() {
        return this._timer !== null;
    }

    start() {
        throw new Error("Not implemented in base class");
    }

    stop() {
        this._timer = null;
    }

    /** @type {number} */
    get targetFrameRate() {
        return this._targetFPS;
    }

    set targetFrameRate(fps) {
        this._targetFPS = fps;
        this._frameTime = 1000 / fps;
    }
}

class RequestAnimationFrameTimer extends BaseTimer {
    constructor() {
        super(120);
    }

    start() {
        const updater = (t) => {
            this._timer = requestAnimationFrame(updater);
            this._onTick(t);
        };
        this._timer = requestAnimationFrame(updater);
    }

    stop() {
        if (this.isRunning) {
            cancelAnimationFrame(this._timer);
            super.stop();
        }
    }
}

const JITSI_HOST = "tele.calla.chat";
const JVB_HOST = JITSI_HOST;
const JVB_MUC = "conference." + JITSI_HOST;

/**
 * A CSS property that will be applied to an element's style attribute.
 **/
class CssProp {
    /**
     * Creates a new CSS property that will be applied to an element's style attribute.
     * @param {string} key - the property name.
     * @param {string} value - the value to set for the property.
     */
    constructor(key, value) {
        this.key = key;
        this.value = value;
        Object.freeze(this);
    }

    /**
     * Set the attribute value on an HTMLElement
     * @param {HTMLElement} elem - the element on which to set the attribute.
     */
    apply(elem) {
        elem.style[this.key] = this.value;
    }
}

class CssPropSet {
    /**
     * @param {...(CssProp|CssPropSet)} rest
     */
    constructor(...rest) {
        this.set = new Map();
        const set = (key, value) => {
            if (value || isBoolean(value)) {
                this.set.set(key, value);
            }
            else if (this.set.has(key)) {
                this.set.delete(key);
            }
        };
        for (let prop of rest) {
            if (prop instanceof CssProp) {
                const { key, value } = prop;
                set(key, value);
            }
            else if (prop instanceof CssPropSet) {
                for (let subProp of prop.set.entries()) {
                    const [key, value] = subProp;
                    set(key, value);
                }
            }
        }
    }

    /**
     * Set the attribute value on an HTMLElement
     * @param {HTMLElement} elem - the element on which to set the attribute.
     */
    apply(elem) {
        for (let prop of this.set.entries()) {
            const [key, value] = prop;
            elem.style[key] = value;
        }
    }
}

/**
 * Combine style properties.
 * @param {...CssProp} rest
 * @returns {CssPropSet}
 */
function styles(...rest) {
    return new CssPropSet(...rest);
}

/**
 * Creates a style attribute with a backgroundColor property.
 * @param {string} v
 * @returns {HtmlAttr}
 **/
function backgroundColor(v) { return new CssProp("backgroundColor", v); }

/**
 * Creates a style attribute with a display property.
 * @param {string} v
 * @returns {HtmlAttr}
 **/
function display(v) { return new CssProp("display", v); }

/**
 * Creates a style attribute with a fontFamily property.
 * @param {string} v
 * @returns {HtmlAttr}
 **/
function fontFamily(v) { return new CssProp("fontFamily", v); }

/**
 * Creates a style attribute with a gridArea property.
 * @param {string} v
 * @returns {HtmlAttr}
 **/
function gridArea(v) { return new CssProp("gridArea", v); }

/**
 * Creates a style attribute with a gridRow property.
 * @param {string} v
 * @returns {HtmlAttr}
 **/
function gridRow(v) { return new CssProp("gridRow", v); }

/**
 * Creates a style attribute with a gridTemplateColumns property.
 * @param {string} v
 * @returns {HtmlAttr}
 **/
function gridTemplateColumns(v) { return new CssProp("gridTemplateColumns", v); }

/**
 * Creates a style attribute with a height property.
 * @param {string} v
 * @returns {HtmlAttr}
 **/
function cssHeight(v) { return new CssProp("height", v); }

/**
 * Creates a style attribute with a margin property.
 * @param {string} v
 * @returns {HtmlAttr}
 **/
function margin(v) { return new CssProp("margin", v); }

/**
 * Creates a style attribute with a textAlign property.
 * @param {string} v
 * @returns {HtmlAttr}
 **/
function textAlign(v) { return new CssProp("textAlign", v); }

/**
 * Creates a style attribute with a width property.
 * @param {string} v
 * @returns {HtmlAttr}
 **/
function cssWidth(v) { return new CssProp("width", v); }

/**
 * Creates a style attribute with a zIndex property.
 * @param {string} v
 * @returns {HtmlAttr}
 **/
function zIndex(v) { return new CssProp("zIndex", v); }


// A selection of fonts for preferred monospace rendering.
const monospaceFonts = "'Droid Sans Mono', 'Consolas', 'Lucida Console', 'Courier New', 'Courier', monospace";
const monospaceFamily = fontFamily(monospaceFonts);
// A selection of fonts that should match whatever the user's operating system normally uses.
const systemFonts = "-apple-system, '.SFNSText-Regular', 'San Francisco', 'Roboto', 'Segoe UI', 'Helvetica Neue', 'Lucida Grande', sans-serif";
const systemFamily = fontFamily(systemFonts);

/**
 * A setter functor for HTML element events.
 **/
class HtmlEvt {
    /**
     * Creates a new setter functor for an HTML element event.
     * @param {string} name - the name of the event to attach to.
     * @param {Function} callback - the callback function to use with the event handler.
     * @param {(boolean|AddEventListenerOptions)=} opts - additional attach options.
     */
    constructor(name, callback, opts) {
        if (!isFunction(callback)) {
            throw new Error("A function instance is required for this parameter");
        }

        this.name = name;
        this.callback = callback;
        this.opts = opts;
        Object.freeze(this);
    }

    /**
     * Add the encapsulate callback as an event listener to the give HTMLElement
     * @param {HTMLElement} elem
     */
    add(elem) {
        elem.addEventListener(this.name, this.callback, this.opts);
    }

    /**
     * Remove the encapsulate callback as an event listener from the give HTMLElement
     * @param {HTMLElement} elem
     */
    remove(elem) {
        elem.removeEventListener(this.name, this.callback);
    }
}

/**
 * The blur event.
 * @param {Function} callback - the callback function to use with the event handler.
 * @param {(boolean|AddEventListenerOptions)=} opts - additional attach options.
 **/
function onBlur(callback, opts) { return new HtmlEvt("blur", callback, opts); }

/**
 * The click event.
 * @param {Function} callback - the callback function to use with the event handler.
 * @param {(boolean|AddEventListenerOptions)=} opts - additional attach options.
 **/
function onClick(callback, opts) { return new HtmlEvt("click", callback, opts); }

/**
 * The focus event.
 * @param {Function} callback - the callback function to use with the event handler.
 * @param {(boolean|AddEventListenerOptions)=} opts - additional attach options.
 **/
function onFocus(callback, opts) { return new HtmlEvt("focus", callback, opts); }

/**
 * The input event.
 * @param {Function} callback - the callback function to use with the event handler.
 * @param {(boolean|AddEventListenerOptions)=} opts - additional attach options.
 **/
function onInput(callback, opts) { return new HtmlEvt("input", callback, opts); }

/**
 * The keypress event.
 * @param {Function} callback - the callback function to use with the event handler.
 * @param {(boolean|AddEventListenerOptions)=} opts - additional attach options.
 **/
function onKeyPress(callback, opts) { return new HtmlEvt("keypress", callback, opts); }

/**
 * The keyup event.
 * @param {Function} callback - the callback function to use with the event handler.
 * @param {(boolean|AddEventListenerOptions)=} opts - additional attach options.
 **/
function onKeyUp(callback, opts) { return new HtmlEvt("keyup", callback, opts); }

/**
 * The mouseout event.
 * @param {Function} callback - the callback function to use with the event handler.
 * @param {(boolean|AddEventListenerOptions)=} opts - additional attach options.
 **/
function onMouseOut(callback, opts) { return new HtmlEvt("mouseout", callback, opts); }

/**
 * The mouseover event.
 * @param {Function} callback - the callback function to use with the event handler.
 * @param {(boolean|AddEventListenerOptions)=} opts - additional attach options.
 **/
function onMouseOver(callback, opts) { return new HtmlEvt("mouseover", callback, opts); }

/**
 * @typedef {(Node|HtmlAttr|HtmlEvt|string|number|boolean|Date)} TagChild
 **/

/**
 * Creates an HTML element for a given tag name.
 * 
 * Boolean attributes that you want to default to true can be passed
 * as just the attribute creating function, 
 *   e.g. `Audio(autoPlay)` vs `Audio(autoPlay(true))`
 * @param {string} name - the name of the tag
 * @param {...TagChild} rest - optional attributes, child elements, and text
 * @returns {HTMLElement}
 */
function tag(name, ...rest) {
    let elem = null;

    for (let i = 0; i < rest.length; ++i) {
        const attr = rest[i];
        if (isFunction(attr)) {
            rest[i] = attr(true);
        }

        if (attr instanceof HtmlAttr
            && attr.key === "id") {
            elem = document.getElementById(attr.value);
        }
    }

    if (elem === null) {
        elem = document.createElement(name);
    }

    for (let x of rest) {
        if (x !== null && x !== undefined) {
            if (isString(x)
                || isNumber(x)
                || isBoolean(x)
                || x instanceof Date) {
                elem.appendChild(document.createTextNode(x));
            }
            else if (x instanceof Node) {
                elem.appendChild(x);
            }
            else if (x.element instanceof Node) {
                elem.appendChild(x.element);
            }
            else if (x instanceof HtmlAttr
                || x instanceof CssProp
                || x instanceof CssPropSet) {
                x.apply(elem);
            }
            else if (x instanceof HtmlEvt) {
                x.add(elem);
            }
            else {
                console.trace(`Skipping ${x}: unsupported value type.`, x);
            }
        }
    }

    return elem;
}

/**
 * Empty an element of all children. This is faster than
 * setting `innerHTML = ""`.
 * @param {any} elem
 */
function clear(elem) {
    while (elem.lastChild) {
        elem.lastChild.remove();
    }
}

/**
 * creates an HTML A tag
 * @param {...import("./tag").TagChild} rest - optional attributes, child elements, and text
 * @returns {HTMLAnchorElement}
 */
function A(...rest) { return tag("a", ...rest); }

/**
 * creates an HTML HtmlButton tag
 * @param {...import("./tag").TagChild} rest - optional attributes, child elements, and text
 * @returns {HTMLButtonElement}
 */
function ButtonRaw(...rest) { return tag("button", ...rest); }

/**
 * creates an HTML Button tag
 * @param {...import("./tag").TagChild} rest - optional attributes, child elements, and text
 * @returns {HTMLButtonElement}
 */
function Button(...rest) { return ButtonRaw(...rest, type("button")); }

/**
 * creates an HTML Canvas tag
 * @param {...import("./tag").TagChild} rest - optional attributes, child elements, and text
 * @returns {HTMLCanvasElement}
 */
function Canvas(...rest) { return tag("canvas", ...rest); }

/**
 * creates an HTML Div tag
 * @param {...import("./tag").TagChild} rest - optional attributes, child elements, and text
 * @returns {HTMLDivElement}
 */
function Div(...rest) { return tag("div", ...rest); }

/**
 * creates an HTML H1 tag
 * @param {...import("./tag").TagChild} rest - optional attributes, child elements, and text
 * @returns {HTMLHeadingElement}
 */
function H1(...rest) { return tag("h1", ...rest); }

/**
 * creates an HTML H2 tag
 * @param {...import("./tag").TagChild} rest - optional attributes, child elements, and text
 * @returns {HTMLHeadingElement}
 */
function H2(...rest) { return tag("h2", ...rest); }

/**
 * creates an HTML Img tag
 * @param {...import("./tag").TagChild} rest - optional attributes, child elements, and text
 * @returns {HTMLImageElement}
 */
function Img(...rest) { return tag("img", ...rest); }

/**
 * creates an HTML Input tag
 * @param {...import("./tag").TagChild} rest - optional attributes, child elements, and text
 * @returns {HTMLInputElement}
 */
function Input(...rest) { return tag("input", ...rest); }

/**
 * creates an HTML Input tag that is an email entry field.
 * @param {...import("./tag").TagChild} rest - optional attributes, child elements, and text
 * @returns {HTMLInputElement}
 */
function InputEmail(...rest) { return Input(type("email"), ...rest) }

/**
 * creates an HTML Input tag that is a range selector.
 * @param {...import("./tag").TagChild} rest - optional attributes, child elements, and text
 * @returns {HTMLInputElement}
 */
function InputRange(...rest) { return Input(type("range"), ...rest) }

/**
 * creates an HTML Input tag that is a text entry field.
 * @param {...import("./tag").TagChild} rest - optional attributes, child elements, and text
 * @returns {HTMLInputElement}
 */
function InputText(...rest) { return Input(type("text"), ...rest) }

/**
 * creates an HTML Input tag that is a URL entry field.
 * @param {...import("./tag").TagChild} rest - optional attributes, child elements, and text
 * @returns {HTMLInputElement}
 */
function InputURL(...rest) { return Input(type("url"), ...rest) }

/**
 * creates an HTML Label tag
 * @param {...import("./tag").TagChild} rest - optional attributes, child elements, and text
 * @returns {HTMLLabelElement}
 */
function Label(...rest) { return tag("label", ...rest); }

/**
 * creates an HTML LI tag
 * @param {...import("./tag").TagChild} rest - optional attributes, child elements, and text
 * @returns {HTMLLIElement}
 */
function LI(...rest) { return tag("li", ...rest); }

/**
 * creates an HTML Option tag
 * @param {...import("./tag").TagChild} rest - optional attributes, child elements, and text
 * @returns {HTMLOptionElement}
 */
function Option(...rest) { return tag("option", ...rest); }

/**
 * creates an HTML P tag
 * @param {...import("./tag").TagChild} rest - optional attributes, child elements, and text
 * @returns {HTMLParagraphElement}
 */
function P(...rest) { return tag("p", ...rest); }

/**
 * creates an HTML Span tag
 * @param {...import("./tag").TagChild} rest - optional attributes, child elements, and text
 * @returns {HTMLSpanElement}
 */
function Span(...rest) { return tag("span", ...rest); }

/**
 * creates an HTML UL tag
 * @param {...import("./tag").TagChild} rest - optional attributes, child elements, and text
 * @returns {HTMLUListElement}
 */
function UL(...rest) { return tag("ul", ...rest); }

/**
 * creates an HTML Video tag
 * @param {...import("./tag").TagChild} rest - optional attributes, child elements, and text
 * @returns {HTMLVideoElement}
 */
function Video(...rest) { return tag("video", ...rest); }

/**
 * Creates an offscreen canvas element, if they are available. Otherwise, returns an HTMLCanvasElement.
 * @param {number} w - the width of the canvas
 * @param {number} h - the height of the canvas
 * @param {...import("./tag").TagChild} rest - optional HTML attributes and child elements, to use in constructing the HTMLCanvasElement if OffscreenCanvas is not available.
 * @returns {OffscreenCanvas|HTMLCanvasElement}
 */
function CanvasOffscreen(w, h, ...rest) {
    if (window.OffscreenCanvas) {
        return new OffscreenCanvas(w, h);
    }
    else {
        return Canvas(...rest, width(w), height(h));
    }
}

/**
 * Creates a Div element with margin: auto.
 * @param {...any} rest
 * @returns {HTMLDivElement}
 */
function Run(...rest) {
    return Div(
        margin("auto"),
        ...rest);
}

const toggleOptionsEvt = new Event("toggleOptions"),
    tweetEvt = new Event("tweet"),
    leaveEvt = new Event("leave"),
    toggleFullscreenEvt = new Event("toggleFullscreen"),
    toggleInstructionsEvt = new Event("toggleInstructions"),
    toggleUserDirectoryEvt = new Event("toggleUserDirectory"),
    toggleAudioEvt = new Event("toggleAudio"),
    toggleVideoEvt = new Event("toggleVideo"),
    changeDevicesEvt = new Event("changeDevices"),
    emoteEvt = new Event("emote"),
    selectEmojiEvt = new Event("selectEmoji"),
    zoomChangedEvt = new Event("zoomChanged");

class ButtonLayer extends EventBase {
    constructor(targetCanvas, zoomMin, zoomMax) {
        super();

        const _ = (evt) => () => this.dispatchEvent(evt);

        const changeZoom = (dz) => {
            this.zoom += dz;
            this.dispatchEvent(zoomChangedEvt);
        };

        this.element = Div(id("controls"));

        this.element.append(

            this.optionsButton = Button(
                id("optionsButton"),
                title("Show/hide options"),
                onClick(_(toggleOptionsEvt)),
                Run(gear.value),
                Run("Options")),

            this.instructionsButton = Button(
                id("instructionsButton"),
                title("Show/hide instructions"),
                onClick(_(toggleInstructionsEvt)),
                Run(questionMark.value),
                Run("Info")),

            this.shareButton = Button(
                id("shareButton"),
                title("Share your current room to twitter"),
                onClick(_(tweetEvt)),
                Img(src("https://cdn2.iconfinder.com/data/icons/minimalism/512/twitter.png"),
                    alt("icon"),
                    role("presentation"),
                    cssHeight("25px"),
                    margin("2px auto -2px auto")),
                Run("Tweet")),

            this.showUsersButton = Button(
                id("showUsersButton"),
                title("View user directory"),
                onClick(_(toggleUserDirectoryEvt)),
                Run(speakingHead.value),
                Run("Users")),


            this.fullscreenButton = Button(
                id("fullscreenButton"),
                title("Toggle fullscreen"),
                onClick(_(toggleFullscreenEvt)),
                onClick(() => this.isFullscreen = !this.isFullscreen),
                Run(squareFourCourners.value),
                Run("Expand")),


            this.leaveButton = Button(
                id("leaveButton"),
                title("Leave the room"),
                onClick(_(leaveEvt)),
                Run(door.value),
                Run("Leave")),

            Div(
                id("toggleAudioControl"),
                className("comboButton"),
                this.toggleAudioButton = Button(
                    id("toggleAudioButton"),
                    title("Toggle audio mute/unmute"),
                    onClick(_(toggleAudioEvt)),
                    this.toggleAudioLabel = Run(speakerHighVolume.value),
                    Run("Audio")),
                this.toggleVideoButton = Button(
                    id("toggleVideoButton"),
                    title("Toggle video mute/unmute"),
                    onClick(_(toggleVideoEvt)),
                    this.toggleVideoLabel = Run(noMobilePhone.value),
                    Run("Video")),
                this.changeDevicesButton = Button(
                    id("changeDevicesButton"),
                    title("Change devices"),
                    onClick(_(changeDevicesEvt)),
                    Run(upwardsButton.value),
                    Run("Change"))),

            Div(
                id("emojiControl"),
                className("comboButton"),
                textAlign("center"),
                Button(
                    id("emoteButton"),
                    title("Emote"),
                    onClick(_(emoteEvt)),
                    this.emoteButton = Run(whiteFlower.value),
                    Run("Emote")),
                Button(
                    id("selectEmoteButton"),
                    title("Select Emoji"),
                    onClick(_(selectEmojiEvt)),
                    Run(upwardsButton.value),
                    Run("Change"))),

            this.zoomInButton = Button(
                id("zoomInButton"),
                title("Zoom in"),
                onClick(() => changeZoom(0.5)),
                Run(magnifyingGlassTiltedLeft.value),
                Run("+")),

            Div(id("zoomSliderContainer"),
                this.slider = InputRange(
                    id("zoomSlider"),
                    title("Zoom"),
                    min(zoomMin),
                    max(zoomMax),
                    step(0.1),
                    value(0),
                    onInput(() => this.dispatchEvent(zoomChangedEvt)))),


            this.zoomOutButton = Button(
                id("zoomOutButton"),
                title("Zoom out"),
                onClick(() => changeZoom(-0.5)),
                Run(magnifyingGlassTiltedRight.value),
                Run("-")));

        this._audioEnabled = true;
        this._videoEnabled = false;

        Object.seal(this);
    }

    get isFullscreen() {
        return document.fullscreenElement !== null;
    }

    set isFullscreen(value) {
        if (value) {
            document.body.requestFullscreen();
        }
        else {
            document.exitFullscreen();
        }
        updateLabel(
            this.fullscreenButton,
            value,
            downRightArrow.value,
            squareFourCourners.value);
    }

    hide() {
        this.element.style.display = "none";
    }

    show() {
        this.element.style.display = "";
    }

    get enabled() {
        return !this.instructionsButton.disabled;
    }

    set enabled(v) {
        for (let button of this.element.querySelectorAll("button")) {
            button.disabled = !v;
        }
    }

    get audioEnabled() {
        return this._audioEnabled;
    }

    set audioEnabled(value) {
        this._audioEnabled = value;
        updateLabel(
            this.toggleAudioLabel,
            value,
            speakerHighVolume.value,
            mutedSpeaker.value);
    }

    get videoEnabled() {
        return this._videoEnabled;
    }

    set videoEnabled(value) {
        this._videoEnabled = value;
        updateLabel(
            this.toggleVideoLabel,
            value,
            videoCamera.value,
            noMobilePhone.value);
    }

    setEmojiButton(key, emoji) {
        this.emoteButton.innerHTML = emoji.value;
    }

    get zoom() {
        return parseFloat(this.slider.value);
    }

    /** @type {number} */
    set zoom(v) {
        this.slider.value = v;
    }
}

/**
 * A pseudo-element that is made out of other elements.
 **/
class HtmlCustomTag extends EventBase {
    /**
     * Creates a new pseudo-element
     * @param {string} tagName - the type of tag that will contain the elements in the custom tag.
     * @param {...import("./tag").TagChild} rest - optional attributes, child elements, and text
     */
    constructor(tagName, ...rest) {
        super();
        this.element = tag(tagName, ...rest);
    }

    /**
     * Gets the ID attribute of the container element.
     * @type {string}
     **/
    get id() {
        return this.element.id;
    }

    /**
     * Retrieves the desired element for attaching events.
     * @returns {HTMLElement}
     **/
    get eventTarget() {
        return this.element;
    }

    /**
     * Determine if an event type should be forwarded to the container element.
     * @param {string} name
     * @returns {boolean}
     */
    isForwardedEvent(name) {
        return true;
    }

    /**
     * Adds an event listener to the container element.
     * @param {string} name - the name of the event to attach to.
     * @param {Function} callback - the callback function to use with the event handler.
     * @param {(boolean|AddEventListenerOptions)=} opts - additional attach options.
     */
    addEventListener(name, callback, opts) {
        if (this.isForwardedEvent(name)) {
            this.eventTarget.addEventListener(name, callback, opts);
        }
        else {
            super.addEventListener(name, callback, opts);
        }
    }

    /**
     * Removes an event listener from the container element.
     * @param {string} name - the name of the event to attach to.
     * @param {Function} callback - the callback function to use with the event handler.
     */
    removeEventListener(name, callback) {
        if (this.isForwardedEvent(name)) {
            this.eventTarget.removeEventListener(name, callback);
        }
        else {
            super.removeEventListener(name, callback);
        }
    }

    /**
     * Gets the style attribute of the underlying select box.
     * @type {ElementCSSInlineStyle}
     */
    get style() {
        return this.element.style;
    }

    get tagName() {
        return this.element.tagName;
    }

    get disabled() {
        return this.element.disabled;
    }

    set disabled(v) {
        this.element.disabled = v;
    }

    /**
     * Moves cursor focus to the underyling element.
     **/
    focus() {
        this.element.focus();
    }

    /**
     * Removes cursor focus from the underlying element.
     **/
    blur() {
        this.element.blur();
    }
}

const disabler$1 = disabled(true),
    enabler$1 = disabled(false);

/** @type {WeakMap<SelectBoxTag, any[]>} */
const values = new WeakMap();

function render(self) {
    clear(self.element);
    if (self.values.length === 0) {
        self.element.append(Option(self.noSelectionText));
        disabler$1.apply(self.element);
    }
    else {
        if (self.emptySelectionEnabled) {
            self.element.append(Option(self.noSelectionText));
        }
        for (let v of self.values) {
            self.element.append(
                Option(
                    value(self.makeID(v)),
                    self.makeLabel(v)));
        }

        enabler$1.apply(self.element);
    }
}

/**
 * Creates a string from a list item to use as the item's ID or label in a select box.
 * @callback makeItemValueCallback
 * @param {any} obj - the object
 * @returns {string}
 */

/**
 * Creates a select box that can bind to collections
 * @param {string} id - the ID to use for the select box
 * @param {string} noSelectionText - the text to display when no items are available.
 * @param {makeItemValueCallback} makeID - a function that evalutes a databound item to create an ID for it.
 * @param {makeItemValueCallback} makeLabel - a function that evalutes a databound item to create a label for it.
 * @param {...import("./tag").TagChild} rest - optional attributes, child elements, and text to use on the select element
 * @returns {SelectBoxTag}
 */
function SelectBox(id, noSelectionText, makeID, makeLabel, ...rest) {
    return new SelectBoxTag(id, noSelectionText, makeID, makeLabel, ...rest);
}

/**
 * A select box that can be databound to collections.
 **/
class SelectBoxTag extends HtmlCustomTag {

    /**
     * Creates a select box that can bind to collections
     * @param {string} tagId - the ID to use for the select box.
     * @param {string} noSelectionText - the text to display when no items are available.
     * @param {makeItemValueCallback} makeID - a function that evalutes a databound item to create an ID for it.
     * @param {makeItemValueCallback} makeLabel - a function that evalutes a databound item to create a label for it.
     * @param {...import("./tag").TagChild} rest - optional attributes, child elements, and text to use on the select element
     */
    constructor(tagId, noSelectionText, makeID, makeLabel, ...rest) {
        super("select", id(tagId), ...rest);

        if (!isFunction(makeID)) {
            throw new Error("makeID parameter must be a Function");
        }

        if (!isFunction(makeLabel)) {
            throw new Error("makeLabel parameter must be a Function");
        }

        this.noSelectionText = noSelectionText;
        this.makeID = (v) => v !== null && makeID(v) || null;
        this.makeLabel = (v) => v !== null && makeLabel(v) || "None";
        this.emptySelectionEnabled = true;

        Object.seal(this);
    }

    /**
     * Gets whether or not the select box will have a vestigial entry for "no selection" or "null" in the select box.
     * @type {boolean}
     **/
    get emptySelectionEnabled() {
        return this._emptySelectionEnabled;
    }

    /**
     * Sets whether or not the select box will have a vestigial entry for "no selection" or "null" in the select box.
     * @param {boolean} value
     **/
    set emptySelectionEnabled(value) {
        this._emptySelectionEnabled = value;
        render(this);
    }

    /**
     * Gets the collection to which the select box was databound
     **/
    get values() {
        if (!values.has(this)) {
            values.set(this, []);
        }
        return values.get(this);
    }

    /**
     * Sets the collection to which the select box will be databound
     **/
    set values(newItems) {
        const curValue = this.selectedValue;
        const values = this.values;
        values.splice(0, values.length, ...newItems);
        render(this);
        this.selectedValue = curValue;
    }

    /**
     * Returns the collection of HTMLOptionElements that are stored in the select box
     * @type {HTMLOptionsCollection}
     */
    get options() {
        return this.element.options;
    }

    /**
     * Gets the index of the item that is currently selected in the select box.
     * The index is offset by -1 if the select box has `emptySelectionEnabled`
     * set to true, so that the indices returned are always in range of the collection
     * to which the select box was databound
     * @type {number}
     */
    get selectedIndex() {
        let i = this.element.selectedIndex;
        if (this.emptySelectionEnabled) {
            --i;
        }
        return i;
    }

    /**
     * Sets the index of the item that should be selected in the select box.
     * The index is offset by -1 if the select box has `emptySelectionEnabled`
     * set to true, so that the indices returned are always in range of the collection
     * to which the select box was databound
     * @param {number} i
     */
    set selectedIndex(i) {
        if (this.emptySelectionEnabled) {
            ++i;
        }
        this.element.selectedIndex = i;
    }

    /**
     * Gets the item at `selectedIndex` in the collection to which the select box was databound
     * @type {any}
     */
    get selectedValue() {
        if (0 <= this.selectedIndex && this.selectedIndex < this.values.length) {
            return this.values[this.selectedIndex];
        }
        else {
            return null;
        }
    }

    /**
     * Gets the index of the given item in the select box's databound collection, then
     * sets that index as the `selectedIndex`.
     * @param {any) value
     */
    set selectedValue(value) {
        this.selectedIndex = this.indexOf(value);
    }

    get selectedText() {
        const opts = this.element.selectedOptions;
        if (opts.length === 1) {
            return opts[0].textContent || opts[0].innerText;
        }
    }

    set selectedText(value) {
        const idx = this.values.findIndex(v =>
            value !== null && this.makeLabel(v) === value);
        this.selectedIndex = idx;
    }

    /**
     * Returns the index of the given item in the select box's databound collection.
     * @param {any} value
     * @returns {number}
     */
    indexOf(value) {
        return this.values
            .findIndex(v =>
                value !== null
                && this.makeID(value) === this.makeID(v));
    }

    /**
     * Checks to see if the value exists in the databound collection.
     * @param {any} value
     * @returns {boolean}
     */
    contains(value) {
        return this.indexOf(value) >= 0.
    }
}

const hiddenEvt = new Event("hidden"),
    shownEvt = new Event("shown");

class FormDialog extends EventBase {
    constructor(tagId) {
        super();

        this.element = Div(id(tagId));
        this.header = this.element.querySelector(".header");
        this.content = this.element.querySelector(".content");
        this.footer = this.element.querySelector(".footer");

        const closeButton = this.element.querySelector(".dialogTitle > button.closeButton");
        if (closeButton) {
            closeButton.addEventListener("click", () => hide(this));
        }
    }

    get tagName() {
        return this.element.tagName;
    }

    get disabled() {
        return this.element.disabled;
    }

    set disabled(v) {
        this.element.disabled = v;
    }

    get style() {
        return this.element.style;
    }

    appendChild(child) {
        return this.element.appendChild(child);
    }

    append(...rest) {
        this.element.append(...rest);
    }

    show() {
        show(this.element);
        this.dispatchEvent(shownEvt);
    }

    async showAsync() {
        show(this);
        await once(this, "hidden");
    }

    hide() {
        hide(this.element);
        this.dispatchEvent(hiddenEvt);
    }
}

const audioInputChangedEvt = new Event("audioInputChanged"),
    audioOutputChangedEvt = new Event("audioOutputChanged"),
    videoInputChangedEvt = new Event("videoInputChanged");

class DevicesDialog extends FormDialog {
    constructor() {
        super("devices");

        const _ = (evt) => () => this.dispatchEvent(evt);

        this.videoInputSelect = SelectBox(
            "videoInputDevices",
            "No video input",
            d => d.deviceId,
            d => d.label,
            onInput(_(videoInputChangedEvt)));

        this.audioInputSelect = SelectBox(
            "audioInputDevices",
            "No audio input",
            d => d.deviceId,
            d => d.label,
            onInput(_(audioInputChangedEvt)));

        this.audioOutputSelect = SelectBox(
            "audioOutputDevices",
            "No audio output",
            d => d.deviceId,
            d => d.label,
            onInput(_(audioOutputChangedEvt)));

        this.audioInputDevices = [];
        this.audioOutputDevices = [];
        this.videoInputDevices = [];

        Object.seal(this);
    }

    get audioInputDevices() {
        return this.audioInputSelect.values;
    }

    set audioInputDevices(values) {
        this.audioInputSelect.values = values;
    }

    get currentAudioInputDevice() {
        return this.audioInputSelect.selectedValue;
    }

    set currentAudioInputDevice(value) {
        this.audioInputSelect.selectedValue = value;
    }


    get audioOutputDevices() {
        return this.audioOutputSelect.values;
    }

    set audioOutputDevices(values) {
        this.audioOutputSelect.values = values;
    }

    get currentAudioOutputDevice() {
        return this.audioOutputSelect.selectedValue;
    }

    set currentAudioOutputDevice(value) {
        this.audioOutputSelect.selectedValue = value;
    }


    get videoInputDevices() {
        return this.videoInputSelect.values;
    }

    set videoInputDevices(values) {
        this.videoInputSelect.values = values;
    }

    get currentVideoInputDevice() {
        return this.videoInputSelect.selectedValue;
    }

    set currentVideoInputDevice(value) {
        this.videoInputSelect.selectedValue = value;
    }
}

/**
 * Constructs a CSS grid area definition.
 * @param {number} x - the starting horizontal cell for the element.
 * @param {number} y - the starting vertical cell for the element.
 * @param {number} [w=null] - the number of cells wide the element should cover.
 * @param {number} [h=null] - the number of cells tall the element should cover.
 * @returns {CssProp}
 */
function gridPos(x, y, w = null, h = null) {
    if (w === null) {
        w = 1;
    }
    if (h === null) {
        h = 1;
    }
    return gridArea(`${y}/${x}/${y + h}/${x + w}`);
}
/**
 * Constructs a CSS grid row definition
 * @param {number} y - the starting vertical cell for the element.
 * @param {number} [h=null] - the number of cells tall the element should cover.
 * @returns {CssProp}
 */
function row(y, h = null) {
    if (h === null) {
        h = 1;
    }
    return gridRow(`${y}/${y + h}`);
}

const displayGrid = display("grid");

/**
 * Create the gridTemplateColumns style attribute, with display set to grid.
 * @param {...string} cols
 * @returns {CssPropSet}
 */
function gridColsDef(...cols) {
    return styles(
        displayGrid,
        gridTemplateColumns(cols.join(" ")));
}

const disabler$2 = disabled(true),
    enabler$2 = disabled(false);

const cancelEvt = new Event("emojiCanceled");

class EmojiForm extends FormDialog {
    constructor() {
        super("emoji");

        this.header.append(
            H2("Recent"),
            this.recent = P("(None)"));

        const previousEmoji = [],
            allAlts = [];

        let selectedEmoji = null,
            idCounter = 0;

        const closeAll = () => {
            for (let alt of allAlts) {
                hide(alt);
            }
        };

        function combine(a, b) {
            let left = a.value;

            let idx = left.indexOf(emojiStyle.value);
            if (idx === -1) {
                idx = left.indexOf(textStyle.value);
            }
            if (idx >= 0) {
                left = left.substring(0, idx);
            }

            return {
                value: left + b.value,
                desc: a.desc + "/" + b.desc
            };
        }

        /**
         * 
         * @param {EmojiGroup} group
         * @param {HTMLElement} container
         * @param {boolean} isAlts
         */
        const addIconsToContainer = (group, container, isAlts) => {
            const alts = group.alts || group;
            for (let icon of alts) {
                const btn = Button(
                    title(icon.desc),
                    onClick((evt) => {
                        selectedEmoji = selectedEmoji && evt.ctrlKey
                            ? combine(selectedEmoji, icon)
                            : icon;
                        this.preview.innerHTML = `${selectedEmoji.value} - ${selectedEmoji.desc}`;
                        enabler$2.apply(this.confirmButton);

                        if (alts) {
                            toggleOpen(alts);
                            btn.innerHTML = icon.value + (isOpen(alts) ? "-" : "+");
                        }
                    }), icon.value);

                let alts = null;

                /** @type {HTMLUListElement|HTMLSpanElement} */
                let g = null;

                if (isAlts) {
                    btn.id = `emoji-with-alt-${idCounter++}`;
                    g = UL(
                        LI(btn,
                            Label(htmlFor(btn.id),
                                icon.desc)));
                }
                else {
                    g = Span(btn);
                }

                if (icon.alts) {
                    alts = Div();
                    allAlts.push(alts);
                    addIconsToContainer(icon, alts, true);
                    hide(alts);
                    g.appendChild(alts);
                    btn.style.width = "3em";
                    btn.innerHTML += "+";
                }

                if (icon.width) {
                    btn.style.width = icon.width;
                }

                if (icon.color) {
                    btn.style.color = icon.color;
                }

                container.appendChild(g);
            }
        };

        for (let group of Object.values(allIcons)) {
            if (group instanceof EmojiGroup) {
                const header = H1(),
                    container = P(),
                    headerButton = A(
                        href("javascript:undefined"),
                        title(group.desc),
                        onClick(() => {
                            toggleOpen(container);
                            headerButton.innerHTML = group.value + (isOpen(container) ? " -" : " +");
                        }),
                        group.value + " -");

                addIconsToContainer(group, container);
                header.appendChild(headerButton);
                this.content.appendChild(header);
                this.content.appendChild(container);
            }
        }

        this.footer.append(

            this.confirmButton = Button(className("confirm"),
                "OK",
                onClick(() => {
                    const idx = previousEmoji.indexOf(selectedEmoji);
                    if (idx === -1) {
                        previousEmoji.push(selectedEmoji);
                        this.recent.innerHTML = "";
                        addIconsToContainer(previousEmoji, this.recent);
                    }

                    this.dispatchEvent(new EmojiSelectedEvent(selectedEmoji));
                    hide(this);
                })),

            Button(className("cancel"),
                "Cancel",
                onClick(() => {
                    disabler$2.apply(this.confirmButton);
                    this.dispatchEvent(cancelEvt);
                    hide(this);
                })),

            this.preview = Span(gridPos(1, 4, 3, 1)));

        disabler$2.apply(this.confirmButton);

        this.selectAsync = () => {
            return new Promise((resolve, reject) => {
                let yes = null,
                    no = null;

                const done = () => {
                    this.removeEventListener("emojiSelected", yes);
                    this.removeEventListener("emojiCanceled", no);
                    this.removeEventListener("hidden", no);
                };

                yes = (evt) => {
                    done();
                    try {
                        resolve(evt.emoji);
                    }
                    catch (exp) {
                        reject(exp);
                    }
                };

                no = () => {
                    done();
                    resolve(null);
                };

                this.addEventListener("emojiSelected", yes);
                this.addEventListener("emojiCanceled", no);
                this.addEventListener("hidden", no);

                closeAll();
                show(this);
            });
        };
    }
}

class EmojiSelectedEvent extends Event {
    constructor(emoji) {
        super("emojiSelected");
        this.emoji = emoji;
    }
}

/** @type {WeakMap<LoginForm, LoginFormPrivate>} */
const selfs = new WeakMap();

class LoginFormPrivate {
    constructor(parent) {
        this.ready = false;
        this.connecting = false;
        this.connected = false;

        this.parent = parent;
    }

    validate() {
        const canConnect = this.parent.roomName.length > 0
            && this.parent.userName.length > 0;

        setLocked(
            this.parent.connectButton,
            !this.ready
            || this.connecting
            || this.connected
            || !canConnect);
        this.parent.connectButton.innerHTML =
            this.connected
                ? "Connected"
                : this.connecting
                    ? "Connecting..."
                    : this.ready
                        ? "Connect"
                        : "Loading...";
    }
}

class LoginForm extends FormDialog {
    constructor() {
        super("login");
        const self = new LoginFormPrivate(this);
        selfs.set(this, self);

        const validate = () => self.validate();

        this.addEventListener("shown", () => self.ready = true);

        this.roomSelectControl = Div(id("roomSelectorControl"));
        this.roomEntryControl = Div(id("roomEntryControl"));


        const curRooms = Array.prototype.map.call(this.element.querySelectorAll("#roomSelector option"), (opt) => {
            return {
                Name: opt.textContent || opt.innerText,
                ShortName: opt.value
            };
        });
        this.roomSelect = SelectBox(
            "roomSelector",
            "No rooms available",
            v => v.ShortName,
            v => v.Name);
        this.roomSelect.addEventListener("input", validate);
        this.roomSelect.emptySelectionEnabled = false;
        this.roomSelect.values = curRooms;
        this.roomSelect.selectedIndex = 0;

        this.roomInput = InputText(id("roomName"));
        this.roomInput.addEventListener("input", validate);
        this.roomInput.addEventListener("keypress", (evt) => {
            if (evt.key === "Enter") {
                if (this.userName.length === 0) {
                    this.userNameInput.focus();
                }
                else if (this.email.length === 0) {
                    this.emailInput.focus();
                }
            }
        });

        this.userNameInput = InputText(id("userName"));
        this.userNameInput.addEventListener("input", validate);
        this.userNameInput.addEventListener("keypress", (evt) => {
            if (evt.key === "Enter") {
                if (this.userName.length === 0) {
                    this.userNameInput.focus();
                }
                else if (this.roomName.length === 0) {
                    if (this.roomSelectMode) {
                        this.roomSelect.focus();
                    }
                    else {
                        this.roomInput.focus();
                    }
                }
            }
        });

        /** @type {HTMLInputElement} */
        this.emailInput = InputEmail(id("email"));
        this.emailInput.addEventListener("keypress", (evt) => {
            if (evt.key === "Enter") {
                if (this.userName.length === 0) {
                    this.userNameInput.focus();
                }
                else if (this.roomName.length === 0) {
                    if (this.roomSelectMode) {
                        this.roomSelect.focus();
                    }
                    else {
                        this.roomInput.focus();
                    }
                }
            }
        });

        const createRoomButton = Button(id("createNewRoom"));
        createRoomButton.addEventListener("click", () => {
            this.roomSelectMode = false;
        });

        const selectRoomButton = Button(id("selectRoom"));
        selectRoomButton.addEventListener("click", () => {
            this.roomSelectMode = true;
        });

        this.connectButton = Button(id("connect"));
        this.addEventListener("login", () => {
            this.connecting = true;
        });

        this.roomSelectMode = true;

        self.validate();
    }

    /**
     * @param {KeyboardEvent} evt
     * @param {Function} callback
     */
    _checkInput(evt, callback) {
        if (!evt.shiftKey
            && !evt.ctrlKey
            && !evt.altKey
            && !evt.metaKey
            && evt.key === "Enter"
            && this.userName.length > 0
            && this.roomName.length > 0) {
            callback(evt);
        }
    }

    addEventListener(evtName, callback, options) {
        if (evtName === "login") {
            this.connectButton.addEventListener("click", callback, options);
            this.roomInput.addEventListener("keypress", (evt) => this._checkInput(evt, callback));
            this.userNameInput.addEventListener("keypress", (evt) => this._checkInput(evt, callback));
        }
        else {
            super.addEventListener(evtName, callback, options);
        }
    }

    removeEventListener(evtName, callback) {
        if (evtName === "login") {
            this.connectButton.removeEventListener("click", callback);
        }
        else {
            super.removeEventListener(evtName, callback);
        }
    }

    get roomSelectMode() {
        return this.roomSelectControl.style.display !== "none";
    }

    set roomSelectMode(value) {
        const self = selfs.get(this);
        setOpen(this.roomSelectControl, value);
        setOpen(this.roomEntryControl, !value);

        if (value) {
            this.roomSelect.selectedValue = { ShortName: this.roomInput.value };
        }
        else if (this.roomSelect.selectedIndex >= 0) {
            this.roomInput.value = this.roomSelect.selectedValue.ShortName;
        }

        self.validate();
    }

    get roomName() {
        const room = this.roomSelectMode
            ? this.roomSelect.selectedValue && this.roomSelect.selectedValue.ShortName
            : this.roomInput.value;

        return room || "";
    }

    set roomName(v) {
        if (v === null
            || v === undefined
            || v.length === 0) {
            v = this.roomSelect.values[0].ShortName;
        }

        this.roomInput.value = v;
        this.roomSelect.selectedValue = { ShortName: v };
        this.roomSelectMode = this.roomSelect.selectedIndex > -1;
        selfs.get(this).validate();
    }

    set userName(value) {
        this.userNameInput.value = value;
        selfs.get(this).validate();
    }

    get userName() {
        return this.userNameInput.value;
    }

    set email(value) {
        this.emailInput.value = value;
    }

    get email() {
        return this.emailInput.value;
    }

    get connectButtonText() {
        return this.connectButton.innerText
            || this.connectButton.textContent;
    }

    set connectButtonText(str) {
        this.connectButton.innerHTML = str;
    }

    get ready() {
        const self = selfs.get(this);
        return self.ready;
    }

    set ready(v) {
        const self = selfs.get(this);
        self.ready = v;
        self.validate();
    }

    get connecting() {
        const self = selfs.get(this);
        return self.connecting;
    }

    set connecting(v) {
        const self = selfs.get(this);
        self.connecting = v;
        self.validate();
    }

    get connected() {
        const self = selfs.get(this);
        return self.connected;
    }

    set connected(v) {
        const self = selfs.get(this);
        self.connected = v;
        this.connecting = false;
    }
}

/**
 * Creates an input box that has a label attached to it.
 * @param {string} id - the ID to use for the input box
 * @param {string} inputType - the type to use for the input box (number, text, etc.)
 * @param {string} labelText - the text to display in the label
 * @param {...import("./tag").TagChild} rest - optional attributes, child elements, and text to use on the select element
 * @returns {LabeledInputTag}
 */
function LabeledInput(id, inputType, labelText, ...rest) {
    return new LabeledInputTag(id, inputType, labelText, ...rest);
}

/**
 * An input box that has a label attached to it.
 **/
class LabeledInputTag extends HtmlCustomTag {
    /**
     * Creates an input box that has a label attached to it.
     * @param {string} id - the ID to use for the input box
     * @param {string} inputType - the type to use for the input box (number, text, etc.)
     * @param {string} labelText - the text to display in the label
     * @param {...import("./tag").TagChild} rest - optional attributes, child elements, and text to use on the select element
     */
    constructor(id, inputType, labelText, ...rest) {
        super("div");

        this.label = Label(
            htmlFor(id),
            labelText);

        this.input = Input(
            type(inputType),
            ...rest);

        this.element.append(
            this.label,
            this.input);

        this.element.style.display = "grid";


        Object.seal(this);
    }

    /**
     * Retrieves the desired element for attaching events.
     * @returns {HTMLElement}
     **/
    get eventTarget() {
        return this.input;
    }

    /**
     * Gets the value attribute of the input element
     * @type {string}
     */
    get value() {
        return this.input.value;
    }

    /**
     * Sets the value attribute of the input element
     * @param {string} v
     */
    set value(v) {
        this.input.value = v;
    }

    /**
     * Gets whether or not the input element is checked, if it's a checkbox or radio button.
     * @type {boolean}
     */
    get checked() {
        return this.input.checked;
    }

    /**
     * Sets whether or not the input element is checked, if it's a checkbox or radio button.
     * @param {boolean} v
     */
    set checked(v) {
        this.input.checked = v;
    }

    /**
     * Sets whether or not the input element should be disabled.
     * @param {boolean} value
     */
    setLocked(value) {
        setLocked(this.input, value);
    }
}

const selectEvt = new Event("select");

/**
 * Creates an OptionPanelTag element
 * @param {string} id - the ID to use for the content element of the option panel
 * @param {string} name - the text to use in the button that triggers displaying the content element
 * @param {...import("./tag").TagChild} rest - optional attributes, child elements, and text to use on the content element
 */
function OptionPanel(id, name, ...rest) {
    return new OptionPanelTag(id, name, ...rest);
}

/**
 * A panel and a button that opens it.
 **/
class OptionPanelTag extends HtmlCustomTag {

    /**
     * Creates a new panel that can be opened with a button click, 
     * living in a collection of panels that will be hidden when
     * this panel is opened.
     * @param {string} panelID - the ID to use for the panel element.
     * @param {string} name - the text to use on the button.
     * @param {...any} rest
     */
    constructor(panelID, name, ...rest) {
        super("div",
            id(panelID),
            P(...rest));

        this.button = Button(
            id(panelID + "Btn"),
            onClick(() => this.dispatchEvent(selectEvt)),
            name);
    }

    isForwardedEvent(name) {
        return name !== "select";
    }

    /**
     * Gets whether or not the panel is visible
     * @type {boolean}
     **/
    get visible() {
        return this.element.style.display !== null;
    }

    /**
     * Sets whether or not the panel is visible
     * @param {boolean} v
     **/
    set visible(v) {
        setOpen(this.element, v);
        this.button.className = v ? "tabSelected" : "tabUnselected";
        this.element.className = v ? "tabSelected" : "tabUnselected";
    }
}

/** @type {WeakMap<EventedGamepad, object> */
const gamepadStates = new WeakMap();

class EventedGamepad extends EventBase {
    constructor(pad) {
        super();
        if (!(pad instanceof Gamepad)) {
            throw new Error("Value must be a Gamepad");
        }

        this.id = pad.id;
        this.displayId = pad.displayId;

        this.connected = pad.connected;
        this.hand = pad.hand;
        this.pose = pad.pose;

        const self = {
            btnDownEvts: [],
            btnUpEvts: [],
            btnState: [],
            axisMaxed: [],
            axisMaxEvts: [],
            sticks: []
        };

        this.lastButtons = [];
        this.buttons = [];
        this.axes = [];
        this.hapticActuators = [];
        this.axisThresholdMax = 0.9;
        this.axisThresholdMin = 0.1;

        this._isStick = (a) => a % 2 === 0 && a < pad.axes.length - 1;

        for (let b = 0; b < pad.buttons.length; ++b) {
            self.btnDownEvts[b] = Object.assign(new Event("gamepadbuttondown"), {
                button: b
            });
            self.btnUpEvts[b] = Object.assign(new Event("gamepadbuttonup"), {
                button: b
            });
            self.btnState[b] = false;

            this.lastButtons[b] = null;
            this.buttons[b] = pad.buttons[b];
        }

        for (let a = 0; a < pad.axes.length; ++a) {
            self.axisMaxEvts[a] = Object.assign(new Event("gamepadaxismaxed"), {
                axis: a
            });
            self.axisMaxed[a] = false;
            if (this._isStick(a)) {
                self.sticks[a / 2] = { x: 0, y: 0 };
            }

            this.axes[a] = pad.axes[a];
        }

        if (pad.hapticActuators !== undefined) {
            for (let h = 0; h < pad.hapticActuators.length; ++h) {
                this.hapticActuators[h] = pad.hapticActuators[h];
            }
        }

        Object.seal(this);
        gamepadStates.set(this, self);
    }

    update(pad) {
        if (!(pad instanceof Gamepad)) {
            throw new Error("Value must be a Gamepad");
        }

        this.connected = pad.connected;
        this.hand = pad.hand;
        this.pose = pad.pose;

        const self = gamepadStates.get(this);

        for (let b = 0; b < pad.buttons.length; ++b) {
            const wasPressed = self.btnState[b],
                pressed = pad.buttons[b].pressed;
            if (pressed !== wasPressed) {
                self.btnState[b] = pressed;
                this.dispatchEvent((pressed
                    ? self.btnDownEvts
                    : self.btnUpEvts)[b]);
            }

            this.lastButtons[b] = this.buttons[b];
            this.buttons[b] = pad.buttons[b];
        }

        for (let a = 0; a < pad.axes.length; ++a) {
            const wasMaxed = self.axisMaxed[a],
                val = pad.axes[a],
                dir = Math.sign(val),
                mag = Math.abs(val),
                maxed = mag >= this.axisThresholdMax,
                mined = mag <= this.axisThresholdMin;
            if (maxed && !wasMaxed) {
                this.dispatchEvent(self.axisMaxEvts[a]);
            }

            this.axes[a] = dir * (maxed ? 1 : (mined ? 0 : mag));
        }

        for (let a = 0; a < this.axes.length - 1; a += 2) {
            const stick = self.sticks[a / 2];
            stick.x = this.axes[a];
            stick.y = this.axes[a + 1];
        }

        if (pad.hapticActuators !== undefined) {
            for (let h = 0; h < pad.hapticActuators.length; ++h) {
                this.hapticActuators[h] = pad.hapticActuators[h];
            }
        }
    }
}

let _getTransform = null;

if (!Object.prototype.hasOwnProperty.call(CanvasRenderingContext2D.prototype, "getTransform")
    && Object.prototype.hasOwnProperty.call(CanvasRenderingContext2D.prototype, "mozCurrentTransform")) {

    class MockDOMMatrix {
        constructor(trans) {
            this.a = trans[0];
            this.b = trans[1];
            this.c = trans[2];
            this.d = trans[3];
            this.e = trans[4];
            this.f = trans[5];
        }

        get is2D() {
            return true;
        }

        get isIdentity() {
            return this.a === 1
                && this.b === 0
                && this.c === 0
                && this.d === 1
                && this.e === 0
                && this.f === 0;
        }

        transformPoint(p) {
            return {
                x: p.x * this.a + p.y * this.c + this.e,
                y: p.x * this.b + p.y * this.d + this.f
            }
        }
    }

    /**
     * @param {CanvasRenderingContext2D} g
     */
    _getTransform = (g) => {
        return new MockDOMMatrix(g.mozCurrentTransform);
    };
}
else {
    /**
     * @param {CanvasRenderingContext2D} g
     */
    _getTransform = (g) => {
        return g.getTransform();
    };
}

function getTransform(g) {
    return _getTransform(g);
}

/**
 * Returns true if the given object is either an HTMLCanvasElement or an OffscreenCanvas.
 * @param {any} obj
 * @returns {boolean}
 */

/**
 * Resizes a canvas element
 * @param {HTMLCanvasElement|OffscreenCanvas} canv
 * @param {number} w - the new width of the canvas
 * @param {number} h - the new height of the canvas
 * @param {number} [superscale=1] - a value by which to scale width and height to achieve supersampling. Defaults to 1.
 * @returns {boolean} - true, if the canvas size changed, false if the given size (with super sampling) resulted in the same size.
 */
function setCanvasSize(canv, w, h, superscale = 1) {
    w = Math.floor(w * superscale);
    h = Math.floor(h * superscale);
    if (canv.width != w
        || canv.height != h) {
        canv.width = w;
        canv.height = h;
        return true;
    }
    return false;
}

/**
 * Resizes the canvas element of a given rendering context.
 * 
 * Note: the imageSmoothingEnabled, textBaseline, textAlign, and font 
 * properties of the context will be restored after the context is resized,
 * as these values are usually reset to their default values when a canvas
 * is resized.
 * @param {RenderingContext} ctx
 * @param {number} w - the new width of the canvas
 * @param {number} h - the new height of the canvas
 * @param {number} [superscale=1] - a value by which to scale width and height to achieve supersampling. Defaults to 1.
 * @returns {boolean} - true, if the canvas size changed, false if the given size (with super sampling) resulted in the same size.
 */
function setContextSize(ctx, w, h, superscale = 1) {
    const oldImageSmoothingEnabled = ctx.imageSmoothingEnabled,
        oldTextBaseline = ctx.textBaseline,
        oldTextAlign = ctx.textAlign,
        oldFont = ctx.font,
        resized = setCanvasSize(
            ctx.canvas,
            w,
            h,
            superscale);

    if (resized) {
        ctx.imageSmoothingEnabled = oldImageSmoothingEnabled;
        ctx.textBaseline = oldTextBaseline;
        ctx.textAlign = oldTextAlign;
        ctx.font = oldFont;
    }

    return resized;
}

/**
 * Resizes a canvas element to match the proportions of the size of the element in the DOM.
 * @param {HTMLCanvasElement} canv
 * @param {number} [superscale=1] - a value by which to scale width and height to achieve supersampling. Defaults to 1.
 * @returns {boolean} - true, if the canvas size changed, false if the given size (with super sampling) resulted in the same size.
 */
function resizeCanvas(canv, superscale = 1) {
    return setCanvasSize(
        canv,
        canv.clientWidth,
        canv.clientHeight,
        superscale);
}

/**
 * @type {WeakMap<TextImage, TextImagePrivate>}
 **/
const selfs$1 = new WeakMap();
const redrawnEvt = new Event("redrawn");

class TextImagePrivate {
    constructor() {
        /** @type {string} */
        this.color = "black";

        /** @type {string} */
        this.bgColor = null;

        /** @type {string} */
        this.fontStyle = "normal";

        /** @type {string} */
        this.fontVariant = "normal";

        /** @type {string} */
        this.fontWeight = "normal";

        /** @type {string} */
        this.fontFamily = "sans-serif";

        /** @type {number} */
        this.fontSize = 20;

        /** @type {number} */
        this.scale = 1;

        /** @type {number} */
        this.padding = {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
        };

        /** @type {string} */
        this.value = null;

        this.canvas = CanvasOffscreen(10, 10);
        this.g = this.canvas.getContext("2d");
        this.g.textBaseline = "top";
    }

    redraw(parent) {
        this.g.clearRect(0, 0, this.canvas.width, this.canvas.height);

        if (this.fontFamily
            && this.fontSize
            && this.color
            && this.scale
            && this.value) {
            const fontHeight = this.fontSize * this.scale;
            const font = makeFont(this);
            this.g.font = font;

            const metrics = this.g.measureText(this.value);
            let dx = 0,
                dy = 0,
                trueWidth = metrics.width,
                trueHeight = fontHeight;
            if (metrics.actualBoundingBoxLeft !== undefined) {
                dy = metrics.actualBoundingBoxAscent;
                trueWidth = metrics.actualBoundingBoxRight - metrics.actualBoundingBoxLeft;
                trueHeight = metrics.actualBoundingBoxDescent + metrics.actualBoundingBoxAscent;
            }

            dx += this.padding.left;
            dy += this.padding.top;
            trueWidth += this.padding.right + this.padding.left;
            trueHeight += this.padding.top + this.padding.bottom;

            setContextSize(this.g, trueWidth, trueHeight);

            if (this.bgColor) {
                this.g.fillStyle = this.bgColor;
                this.g.fillRect(0, 0, this.canvas.width, this.canvas.height);
            }
            else {
                this.g.clearRect(0, 0, this.canvas.width, this.canvas.height);
            }

            this.g.fillStyle = this.color;
            this.g.fillText(this.value, dx, dy);
            parent.dispatchEvent(redrawnEvt);
        }
    }
}

class TextImage extends EventBase {
    /**
     * @param {string} fontFamily
     */
    constructor() {
        super();
        selfs$1.set(this, new TextImagePrivate());
    }

    async loadFontAndSetText(value = null) {
        const font = makeFont(this);
        await loadFont(font, value);
        this.value = value;
    }

    get canvas() {
        return selfs$1.get(this).canvas;
    }

    get width() {
        const self = selfs$1.get(this);
        return self.canvas.width / self.scale;
    }

    get height() {
        const self = selfs$1.get(this);
        return self.canvas.height / self.scale;
    }

    get scale() {
        return selfs$1.get(this).scale;
    }

    set scale(v) {
        if (this.scale !== v) {
            const self = selfs$1.get(this);
            self.scale = v;
            self.redraw(this);
        }
    }

    get padding() {
        return selfs$1.get(this).padding;
    }

    set padding(v) {

        if (v instanceof Array) {
            if (v.length === 1) {
                v = {
                    top: v[0],
                    right: v[0],
                    bottom: v[0],
                    left: v[0]
                };
            }
            else if (v.length === 2) {
                v = {
                    top: v[0],
                    right: v[1],
                    bottom: v[0],
                    left: v[1]
                };
            }
            else if (v.length === 4) {
                v = {
                    top: v[0],
                    right: v[1],
                    bottom: v[2],
                    left: v[3]
                };
            }
            else {
                return;
            }
        }
        else if (isNumber(v)) {
            v = {
                top: v,
                right: v,
                bottom: v,
                left: v
            };
        }


        if (this.padding.top !== v.top
            || this.padding.right != v.right
            || this.padding.bottom != v.bottom
            || this.padding.left != v.left) {
            const self = selfs$1.get(this);
            self.padding = v;
            self.redraw(this);
        }
    }

    get fontStyle() {
        return selfs$1.get(this).fontStyle;
    }

    set fontStyle(v) {
        if (this.fontStyle !== v) {
            const self = selfs$1.get(this);
            self.fontStyle = v;
            self.redraw(this);
        }
    }

    get fontVariant() {
        return selfs$1.get(this).fontVariant;
    }

    set fontVariant(v) {
        if (this.fontVariant !== v) {
            const self = selfs$1.get(this);
            self.fontVariant = v;
            self.redraw(this);
        }
    }

    get fontWeight() {
        return selfs$1.get(this).fontWeight;
    }

    set fontWeight(v) {
        if (this.fontWeight !== v) {
            const self = selfs$1.get(this);
            self.fontWeight = v;
            self.redraw(this);
        }
    }

    get fontSize() {
        return selfs$1.get(this).fontSize;
    }

    set fontSize(v) {
        if (this.fontSize !== v) {
            const self = selfs$1.get(this);
            self.fontSize = v;
            self.redraw(this);
        }
    }

    get fontFamily() {
        return selfs$1.get(this).fontFamily;
    }

    set fontFamily(v) {
        if (this.fontFamily !== v) {
            const self = selfs$1.get(this);
            self.fontFamily = v;
            self.redraw(this);
        }
    }

    get color() {
        return selfs$1.get(this).color;
    }

    set color(v) {
        if (this.color !== v) {
            const self = selfs$1.get(this);
            self.color = v;
            self.redraw(this);
        }
    }

    get bgColor() {
        return selfs$1.get(this).bgColor;
    }

    set bgColor(v) {
        if (this.bgColor !== v) {
            const self = selfs$1.get(this);
            self.bgColor = v;
            self.redraw(this);
        }
    }

    get value() {
        return selfs$1.get(this).value;
    }

    set value(v) {
        if (this.value !== v) {
            const self = selfs$1.get(this);
            self.value = v;
            self.redraw(this);
        }
    }

    /**
     *
     * @param {CanvasRenderingContext2D} g - the canvas to which to render the text.
     * @param {number} x
     * @param {number} y
     */
    draw(g, x, y) {
        const self = selfs$1.get(this);
        if (self.canvas.width > 0
            && self.canvas.height > 0) {
            g.drawImage(self.canvas, x, y, this.width, this.height);
        }
    }
}

/**
 * Types of avatars.
 * @enum {string}
 **/
const AvatarMode = Object.freeze({
    none: null,
    emoji: "emoji",
    photo: "photo",
    video: "video"
});

/**
 * A base class for different types of avatars.
 **/
class BaseAvatar {

    /**
     * Encapsulates a resource to use as an avatar.
     * @param {boolean} canSwim
     */
    constructor(canSwim) {
        this.canSwim = canSwim;
        this.element = Canvas(128, 128);
        this.g = this.element.getContext("2d");
    }

    /**
     * Render the avatar at a certain size.
     * @param {CanvasRenderingContext2D} g - the context to render to
     * @param {number} width - the width the avatar should be rendered at
     * @param {number} height - the height the avatar should be rendered at.
     * @param {boolean} isMe - whether the avatar is the local user
     */
    draw(g, width, height, isMe) {
        const aspectRatio = this.element.width / this.element.height,
            w = aspectRatio > 1 ? width : aspectRatio * height,
            h = aspectRatio > 1 ? width / aspectRatio : height,
            dx = (width - w) / 2,
            dy = (height - h) / 2;
        g.drawImage(
            this.element,
            dx, dy,
            w, h);
    }
}

/**
 * An avatar that uses a Unicode emoji as its representation
 **/
class EmojiAvatar extends BaseAvatar {

    /**
     * Creatse a new avatar that uses a Unicode emoji as its representation.
     * @param {import("../../emoji/Emoji").Emoji} emoji
     */
    constructor(emoji) {
        super(isSurfer(emoji));

        this.value = emoji.value;
        this.desc = emoji.desc;

        const emojiText = new TextImage();

        emojiText.color = emoji.color || "black";
        emojiText.fontFamily = "Noto Color Emoji";
        emojiText.fontSize = 256;
        emojiText.value = this.value;
        setContextSize(this.g, emojiText.width, emojiText.height);
        emojiText.draw(this.g, 0, 0);
    }
}

/**
 * An avatar that uses an Image as its representation.
 **/
class PhotoAvatar extends BaseAvatar {

    /**
     * Creates a new avatar that uses an Image as its representation.
     * @param {(URL|string)} url
     */
    constructor(url) {
        super(false);

        const img = new Image();
        img.addEventListener("load", () => {
            const offset = (img.width - img.height) / 2,
                sx = Math.max(0, offset),
                sy = Math.max(0, -offset),
                dim = Math.min(img.width, img.height);
            setContextSize(this.g, dim, dim);
            this.g.drawImage(img,
                sx, sy,
                dim, dim,
                0, 0,
                dim, dim);
        });

        /** @type {string} */
        this.url
            = img.src
            = url && url.href || url;
    }
}

const isFirefox = typeof InstallTrigger !== "undefined";
const isIOS = ["iPad", "iPhone", "iPod"].indexOf(navigator.platform) >= 0;

/**
 * An avatar that uses an HTML Video element as its representation.
 **/
class VideoAvatar extends BaseAvatar {
    /**
     * Creates a new avatar that uses a MediaStream as its representation.
     * @param {MediaStream|HTMLVideoElement} stream
     */
    constructor(stream) {
        super(false);

        let video = null;
        if (stream instanceof HTMLVideoElement) {
            video = stream;
        }
        else if (stream instanceof MediaStream) {
            video = Video(
                autoPlay,
                playsInline,
                muted,
                volume(0),
                srcObject(stream));
        }
        else {
            throw new Error("Can only create a video avatar from an HTMLVideoElement or MediaStream.");
        }

        this.video = video;

        if (!isIOS) {
            video.play();
            once(video, "canplay")
                .then(() => video.play());
        }
    }

    /**
     * Render the avatar at a certain size.
     * @param {CanvasRenderingContext2D} g - the context to render to
     * @param {number} width - the width the avatar should be rendered at
     * @param {number} height - the height the avatar should be rendered at.
     * @param {boolean} isMe - whether the avatar is the local user
     */
    draw(g, width, height, isMe) {
        if (this.video.videoWidth > 0
            && this.video.videoHeight > 0) {
            const offset = (this.video.videoWidth - this.video.videoHeight) / 2,
                sx = Math.max(0, offset),
                sy = Math.max(0, -offset),
                dim = Math.min(this.video.videoWidth, this.video.videoHeight);
            setContextSize(this.g, dim, dim);
            this.g.save();
            if (isMe) {
                this.g.translate(dim, 0);
                this.g.scale(-1, 1);
            }
            this.g.drawImage(
                this.video,
                sx, sy,
                dim, dim,
                0, 0,
                dim, dim);
            this.g.restore();
        }

        super.draw(g, width, height, isMe);
    }
}

const POSITION_REQUEST_DEBOUNCE_TIME = 1,
    STACKED_USER_OFFSET_X = 5,
    STACKED_USER_OFFSET_Y = 5,
    eventNames$1 = ["userMoved", "userPositionNeeded"],
    muteAudioIcon = new TextImage(),
    speakerActivityIcon = new TextImage();

muteAudioIcon.fontFamily = "Noto Color Emoji";
muteAudioIcon.value = mutedSpeaker.value;
speakerActivityIcon.fontFamily = "Noto Color Emoji";
speakerActivityIcon.value = speakerMediumVolume.value;

class User extends EventBase {
    /**
     * 
     * @param {string} id
     * @param {string} displayName
     * @param {import("../calla").InterpolatedPose} pose
     * @param {boolean} isMe
     */
    constructor(id, displayName, pose, isMe) {
        super();

        this.id = id;
        this.pose = pose;
        this.label = isMe ? "(Me)" : `(${this.id})`;

        /** @type {AvatarMode} */
        this.setAvatarVideo(null);
        this.avatarImage = null;
        this.avatarEmoji = bust;

        this.audioMuted = false;
        this.videoMuted = true;
        this.isMe = isMe;
        this.isActive = false;
        this.stackUserCount = 1;
        this.stackIndex = 0;
        this.stackAvatarHeight = 0;
        this.stackAvatarWidth = 0;
        this.stackOffsetX = 0;
        this.stackOffsetY = 0;
        this.lastPositionRequestTime = performance.now() / 1000 - POSITION_REQUEST_DEBOUNCE_TIME;
        this.visible = true;
        this.userNameText = new TextImage();
        this.userNameText.color = "white";
        this.userNameText.fontSize = 128;
        this._displayName = null;
        this.displayName = displayName;
        Object.seal(this);
    }

    get x() {
        return this.pose.current.p.x;
    }

    get y() {
        return this.pose.current.p.z;
    }

    get gridX() {
        return this.pose.end.p.x;
    }

    get gridY() {
        return this.pose.end.p.z;
    }

    deserialize(evt) {
        switch (evt.avatarMode) {
            case AvatarMode.emoji:
                this.avatarEmoji = evt.avatarID;
                break;
            case AvatarMode.photo:
                this.avatarImage = evt.avatarID;
                break;
        }
    }

    serialize() {
        return {
            id: this.id,
            avatarMode: this.avatarMode,
            avatarID: this.avatarID
        };
    }

    /**
     * An avatar using a live video.
     * @type {VideoAvatar}
     **/
    get avatarVideo() {
        return this._avatarVideo;
    }

    /**
     * Set the current video element used as the avatar.
     * @param {MediaStream} stream
     **/
    setAvatarVideo(stream) {
        if (stream instanceof MediaStream) {
            this._avatarVideo = new VideoAvatar(stream);
        }
        else {
            this._avatarVideo = null;
        }
    }

    /**
     * An avatar using a photo
     * @type {string}
     **/
    get avatarImage() {
        return this._avatarImage
            && this._avatarImage.url
            || null;
    }

    /**
     * Set the URL of the photo to use as an avatar.
     * @param {string} url
     */
    set avatarImage(url) {
        if (isString(url)
            && url.length > 0) {
            this._avatarImage = new PhotoAvatar(url);
        }
        else {
            this._avatarImage = null;
        }
    }

    /**
     * An avatar using a Unicode emoji.
     * @type {EmojiAvatar}
     **/
    get avatarEmoji() {
        return this._avatarEmoji;
    }

    /**
     * Set the emoji to use as an avatar.
     * @param {import("../emoji/Emoji").Emoji} emoji
     */
    set avatarEmoji(emoji) {
        if (emoji
            && emoji.value
            && emoji.desc) {
            this._avatarEmoji = new EmojiAvatar(emoji);
        }
        else {
            this._avatarEmoji = null;
        }
    }

    /**
     * Returns the type of avatar that is currently active.
     * @returns {AvatarMode}
     **/
    get avatarMode() {
        if (this._avatarVideo) {
            return AvatarMode.video;
        }
        else if (this._avatarImage) {
            return AvatarMode.photo;
        }
        else if (this._avatarEmoji) {
            return AvatarMode.emoji;
        }
        else {
            return AvatarMode.none;
        }
    }

    /**
     * Returns a serialized representation of the current avatar,
     * if such a representation exists.
     * @returns {string}
     **/
    get avatarID() {
        switch (this.avatarMode) {
            case AvatarMode.emoji:
                return { value: this.avatarEmoji.value, desc: this.avatarEmoji.desc };
            case AvatarMode.photo:
                return this.avatarImage;
            default:
                return null;
        }
    }

    /**
     * Returns the current avatar
     * @returns {import("./avatars/BaseAvatar").BaseAvatar}
     **/
    get avatar() {
        switch (this.avatarMode) {
            case AvatarMode.emoji:
                return this._avatarEmoji;
            case AvatarMode.photo:
                return this._avatarImage;
            case AvatarMode.video:
                return this._avatarVideo;
            default:
                return null;
        }
    }

    addEventListener(evtName, func, opts) {
        if (eventNames$1.indexOf(evtName) === -1) {
            throw new Error(`Unrecognized event type: ${evtName}`);
        }

        super.addEventListener(evtName, func, opts);
    }

    get displayName() {
        return this._displayName || this.label;
    }

    set displayName(name) {
        this._displayName = name;
        this.userNameText.value = this.displayName;
    }

    moveTo(x, y) {
        if (this.isMe) {
            this.moveEvent.x = x;
            this.moveEvent.y = y;
            this.dispatchEvent(this.moveEvent);
        }
    }

    update(map, users) {
        const t = performance.now() / 1000;

        this.stackUserCount = 0;
        this.stackIndex = 0;
        for (let user of users.values()) {
            if (user.gridX === this.gridX
                && user.gridY === this.gridY) {
                if (user.id === this.id) {
                    this.stackIndex = this.stackUserCount;
                }
                ++this.stackUserCount;
            }
        }

        this.stackAvatarWidth = map.tileWidth - (this.stackUserCount - 1) * STACKED_USER_OFFSET_X;
        this.stackAvatarHeight = map.tileHeight - (this.stackUserCount - 1) * STACKED_USER_OFFSET_Y;
        this.stackOffsetX = this.stackIndex * STACKED_USER_OFFSET_X;
        this.stackOffsetY = this.stackIndex * STACKED_USER_OFFSET_Y;
    }

    drawShadow(g, map) {
        const scale = getTransform(g).a,
            x = this.x * map.tileWidth,
            y = this.y * map.tileHeight,
            t = getTransform(g),
            p = t.transformPoint({ x, y });

        this.visible = -map.tileWidth <= p.x
            && p.x < g.canvas.width
            && -map.tileHeight <= p.y
            && p.y < g.canvas.height;

        if (this.visible) {
            g.save();
            {
                g.shadowColor = "rgba(0, 0, 0, 0.5)";
                g.shadowOffsetX = 3 * scale;
                g.shadowOffsetY = 3 * scale;
                g.shadowBlur = 3 * scale;

                this.innerDraw(g, map);
            }
            g.restore();
        }
    }

    drawAvatar(g, map) {
        if (this.visible) {
            g.save();
            {
                this.innerDraw(g, map);
                if (this.isActive && !this.audioMuted) {
                    const height = this.stackAvatarHeight / 2,
                        scale = getTransform(g).a;
                    speakerActivityIcon.fontSize = height;
                    speakerActivityIcon.scale = scale;
                    speakerActivityIcon.draw(g, this.stackAvatarWidth - speakerActivityIcon.width, 0);
                }
            }
            g.restore();
        }
    }

    innerDraw(g, map) {
        g.translate(
            this.x * map.tileWidth + this.stackOffsetX,
            this.y * map.tileHeight + this.stackOffsetY);
        g.fillStyle = "black";
        g.textBaseline = "top";

        if (this.avatar) {
            this.avatar.draw(g, this.stackAvatarWidth, this.stackAvatarHeight, this.isMe);
        }

        if (this.audioMuted || !this.videoMuted) {

            const height = this.stackAvatarHeight / 2,
                scale = getTransform(g).a;

            if (this.audioMuted) {
                muteAudioIcon.fontSize = height;
                muteAudioIcon.scale = scale;
                muteAudioIcon.draw(g, this.stackAvatarWidth - muteAudioIcon.width, 0);
            }
        }
    }

    drawName(g, map, fontSize) {
        if (this.visible) {
            const scale = getTransform(g).a;
            g.save();
            {
                g.translate(
                    this.x * map.tileWidth + this.stackOffsetX,
                    this.y * map.tileHeight + this.stackOffsetY);
                g.shadowColor = "black";
                g.shadowOffsetX = 3 * scale;
                g.shadowOffsetY = 3 * scale;
                g.shadowBlur = 3 * scale;

                const textScale = fontSize / this.userNameText.fontSize;
                g.scale(textScale, textScale);
                this.userNameText.draw(g, 0, -this.userNameText.height);
            }
            g.restore();
        }
    }

    drawHearingTile(g, map, dx, dy, p) {
        g.save();
        {
            g.translate(
                (this.gridX + dx) * map.tileWidth,
                (this.gridY + dy) * map.tileHeight);
            g.strokeStyle = `rgba(0, 255, 0, ${(1 - p) / 2})`;
            g.strokeRect(0, 0, map.tileWidth, map.tileHeight);
        }
        g.restore();
    }

    drawHearingRange(g, map, minDist, maxDist) {
        const scale = getTransform(g).a,
            tw = Math.min(maxDist, Math.ceil(g.canvas.width / (2 * map.tileWidth * scale))),
            th = Math.min(maxDist, Math.ceil(g.canvas.height / (2 * map.tileHeight * scale)));

        for (let dy = 0; dy < th; ++dy) {
            for (let dx = 0; dx < tw; ++dx) {
                const dist = Math.sqrt(dx * dx + dy * dy),
                    p = project(dist, minDist, maxDist);
                if (p <= 1) {
                    this.drawHearingTile(g, map, dx, dy, p);
                    if (dy != 0) {
                        this.drawHearingTile(g, map, dx, -dy, p);
                    }
                    if (dx != 0) {
                        this.drawHearingTile(g, map, -dx, dy, p);
                    }
                    if (dx != 0 && dy != 0) {
                        this.drawHearingTile(g, map, -dx, -dy, p);
                    }
                }
            }
        }
    }
}

const inputBindingChangedEvt = new Event("inputBindingChanged");

class InputBinding extends EventBase {
    constructor() {
        super();

        const bindings = new Map([
            ["keyButtonUp", "ArrowUp"],
            ["keyButtonDown", "ArrowDown"],
            ["keyButtonLeft", "ArrowLeft"],
            ["keyButtonRight", "ArrowRight"],
            ["keyButtonEmote", "e"],
            ["keyButtonToggleAudio", "a"],
            ["keyButtonZoomOut", "["],
            ["keyButtonZoomIn", "]"],

            ["gpAxisLeftRight", 0],
            ["gpAxisUpDown", 1],

            ["gpButtonEmote", 0],
            ["gpButtonToggleAudio", 1],
            ["gpButtonZoomIn", 6],
            ["gpButtonZoomOut", 7],
            ["gpButtonUp", 12],
            ["gpButtonDown", 13],
            ["gpButtonLeft", 14],
            ["gpButtonRight", 15]
        ]);

        for (let id of bindings.keys()) {
            Object.defineProperty(this, id, {
                get: () => bindings.get(id),
                set: (v) => {
                    if (bindings.has(id)
                        && v !== bindings.get(id)) {
                        bindings.set(id, v);
                        this.dispatchEvent(inputBindingChangedEvt);
                    }
                }
            });
        }

        this.clone = () => {
            const c = {};
            for (let kp of bindings.entries()) {
                c[kp[0]] = kp[1];
            }
            return c;
        };

        Object.freeze(this);
    }
}

const keyWidthStyle = cssWidth("7em"),
    numberWidthStyle = cssWidth("3em"),
    avatarUrlChangedEvt = new Event("avatarURLChanged"),
    gamepadChangedEvt = new Event("gamepadChanged"),
    selectAvatarEvt = new Event("selectAvatar"),
    fontSizeChangedEvt = new Event("fontSizeChanged"),
    inputBindingChangedEvt$1 = new Event("inputBindingChanged"),
    audioPropsChangedEvt = new Event("audioPropertiesChanged"),
    toggleDrawHearingEvt = new Event("toggleDrawHearing"),
    toggleVideoEvt$1 = new Event("toggleVideo"),
    gamepadButtonUpEvt = Object.assign(new Event("gamepadbuttonup"), {
        button: 0
    }),
    gamepadAxisMaxedEvt = Object.assign(new Event("gamepadaxismaxed"), {
        axis: 0
    });

const disabler$3 = disabled(true),
    enabler$3 = disabled(false);

/** @type {WeakMap<OptionsForm, OptionsFormPrivate>} */
const selfs$2 = new WeakMap();

class OptionsFormPrivate {
    constructor() {
        this.inputBinding = new InputBinding();
        /** @type {EventedGamepad} */
        this.pad = null;
    }
}

class OptionsForm extends FormDialog {
    constructor() {
        super("options");

        const _ = (evt) => () => this.dispatchEvent(evt);

        const self = new OptionsFormPrivate();
        selfs$2.set(this, self);

        const audioPropsChanged = onInput(_(audioPropsChangedEvt));

        const makeKeyboardBinder = (id, label) => {
            const key = LabeledInput(
                id,
                "text",
                label,
                keyWidthStyle,
                onKeyUp((evt) => {
                    if (evt.key !== "Tab"
                        && evt.key !== "Shift") {
                        key.value
                            = self.inputBinding[id]
                            = evt.key;
                        this.dispatchEvent(inputBindingChangedEvt$1);
                    }
                }));
            key.value = self.inputBinding[id];
            return key;
        };

        const makeGamepadButtonBinder = (id, label) => {
            const gp = LabeledInput(
                id,
                "text",
                label,
                numberWidthStyle);
            this.addEventListener("gamepadbuttonup", (evt) => {
                if (document.activeElement === gp.input) {
                    gp.value
                        = self.inputBinding[id]
                        = evt.button;
                    this.dispatchEvent(inputBindingChangedEvt$1);
                }
            });
            gp.value = self.inputBinding[id];
            return gp;
        };

        const makeGamepadAxisBinder = (id, label) => {
            const gp = LabeledInput(
                id,
                "text",
                label,
                numberWidthStyle);
            this.addEventListener("gamepadaxismaxed", (evt) => {
                if (document.activeElement === gp.input) {
                    gp.value
                        = self.inputBinding[id]
                        = evt.axis;
                    this.dispatchEvent(inputBindingChangedEvt$1);
                }
            });
            gp.value = self.inputBinding[id];
            return gp;
        };

        const panels = [
            OptionPanel("avatar", "Avatar",
                Div(
                    Label(
                        htmlFor("selectAvatarEmoji"),
                        "Emoji: "),
                    Button(
                        id("selectAvatarEmoji"),
                        "Select",
                        onClick(_(selectAvatarEvt)))),
                " or ",
                Div(
                    Label(
                        htmlFor("setAvatarURL"),
                        "Photo: "),

                    this.avatarURLInput = InputURL(
                        placeHolder("https://example.com/me.png")),
                    Button(
                        id("setAvatarURL"),
                        "Set",
                        onClick(() => {
                            this.avatarURL = this.avatarURLInput.value;
                            this.dispatchEvent(avatarUrlChangedEvt);
                        })),
                    this.clearAvatarURLButton = Button(
                        disabled,
                        "Clear",
                        onClick(() => {
                            this.avatarURL = null;
                            this.dispatchEvent(avatarUrlChangedEvt);
                        }))),
                " or ",
                Div(
                    Label(
                        htmlFor("videoAvatarButton"),
                        "Video: "),
                    this.useVideoAvatarButton = Button(
                        id("videoAvatarButton"),
                        "Use video",
                        onClick(_(toggleVideoEvt$1)))),
                this.avatarPreview = Canvas(
                    width(256),
                    height(256))),

            OptionPanel("interface", "Interface",
                this.fontSizeInput = LabeledInput(
                    "fontSize",
                    "number",
                    "Font size: ",
                    value(10),
                    min(5),
                    max(32),
                    numberWidthStyle,
                    onInput(_(fontSizeChangedEvt))),
                P(
                    this.drawHearingCheck = LabeledInput(
                        "drawHearing",
                        "checkbox",
                        "Draw hearing range: ",
                        onInput(() => {
                            this.drawHearing = !this.drawHearing;
                            this.dispatchEvent(toggleDrawHearingEvt);
                        })),
                    this.audioMinInput = LabeledInput(
                        "minAudio",
                        "number",
                        "Min: ",
                        value(1),
                        min(0),
                        max(100),
                        numberWidthStyle,
                        audioPropsChanged),
                    this.audioMaxInput = LabeledInput(
                        "maxAudio",
                        "number",
                        "Min: ",
                        value(10),
                        min(0),
                        max(100),
                        numberWidthStyle,
                        audioPropsChanged),
                    this.audioRolloffInput = LabeledInput(
                        "rollof",
                        "number",
                        "Rollof: ",
                        value(1),
                        min(0.1),
                        max(10),
                        step(0.1),
                        numberWidthStyle,
                        audioPropsChanged))),

            OptionPanel("keyboard", "Keyboard",
                this.keyButtonUp = makeKeyboardBinder("keyButtonUp", "Up: "),
                this.keyButtonDown = makeKeyboardBinder("keyButtonDown", "Down: "),
                this.keyButtonLeft = makeKeyboardBinder("keyButtonLeft", "Left: "),
                this.keyButtonRight = makeKeyboardBinder("keyButtonRight", "Right: "),
                this.keyButtonEmote = makeKeyboardBinder("keyButtonEmote", "Emote: "),
                this.keyButtonToggleAudio = makeKeyboardBinder("keyButtonToggleAudio", "Toggle audio: ")),

            OptionPanel("gamepad", "Gamepad",
                Div(
                    Label(htmlFor("gamepads"),

                        "Use gamepad: "),
                    this.gpSelect = SelectBox(
                        "gamepads",
                        "No gamepad",
                        gp => gp.id,
                        gp => gp.id,
                        onInput(_(gamepadChangedEvt)))),
                this.gpAxisLeftRight = makeGamepadAxisBinder("gpAxisLeftRight", "Left/Right axis:"),
                this.gpAxisUpDown = makeGamepadAxisBinder("gpAxisUpDown", "Up/Down axis:"),
                this.gpButtonUp = makeGamepadButtonBinder("gpButtonUp", "Up button: "),
                this.gpButtonDown = makeGamepadButtonBinder("gpButtonDown", "Down button: "),
                this.gpButtonLeft = makeGamepadButtonBinder("gpButtonLeft", "Left button: "),
                this.gpButtonRight = makeGamepadButtonBinder("gpButtonRight", "Right button: "),
                this.gpButtonEmote = makeGamepadButtonBinder("gpButtonEmote", "Emote button: "),
                this.gpButtonToggleAudio = makeGamepadButtonBinder("gpButtonToggleAudio", "Toggle audio button: "))
        ];

        const cols = [];
        for (let i = 0; i < panels.length; ++i) {
            cols[i] = "1fr";
            panels[i].element.style.gridColumnStart = i + 1;
        }

        gridColsDef(...cols).apply(this.header);

        this.header.append(...panels.map(p => p.button));
        this.content.append(...panels.map(p => p.element));

        const showPanel = (p) =>
            () => {
                for (let i = 0; i < panels.length; ++i) {
                    panels[i].visible = i === p;
                }
            };

        for (let i = 0; i < panels.length; ++i) {
            panels[i].visible = i === 0;
            panels[i].addEventListener("select", showPanel(i));
        }

        self.inputBinding.addEventListener("inputBindingChanged", () => {
            for (let id of Object.getOwnPropertyNames(self.inputBinding)) {
                if (value[id] !== undefined
                    && this[id] != undefined) {
                    this[id].value = value[id];
                }
            }
        });

        this.gamepads = [];

        this._drawHearing = false;

        /** @type {User} */
        this.user = null;
        this._avatarG = this.avatarPreview.getContext("2d");

        Object.seal(this);
    }

    update() {
        if (isOpen(this)) {
            const pad = this.currentGamepad;
            if (pad) {
                if (self.pad) {
                    self.pad.update(pad);
                }
                else {
                    self.pad = new EventedGamepad(pad);
                    self.pad.addEventListener("gamepadbuttonup", (evt) => {
                        gamepadButtonUpEvt.button = evt.button;
                        this.dispatchEvent(gamepadButtonUpEvt);
                    });
                    self.pad.addEventListener("gamepadaxismaxed", (evt) => {
                        gamepadAxisMaxedEvt.axis = evt.axis;
                        this.dispatchEvent(gamepadAxisMaxedEvt);
                    });
                }
            }

            if (this.user && this.user.avatar) {
                this._avatarG.clearRect(0, 0, this.avatarPreview.width, this.avatarPreview.height);
                this.user.avatar.draw(this._avatarG, this.avatarPreview.width, this.avatarPreview.height, true);
            }
        }
    }

    get avatarURL() {
        if (this.avatarURLInput.value.length === 0) {
            return null;
        }
        else {
            return this.avatarURLInput.value;
        }
    }

    set avatarURL(v) {
        if (isString(v)) {
            this.avatarURLInput.value = v;
            enabler$3.apply(this.clearAvatarURLButton);
        }
        else {
            this.avatarURLInput.value = "";
            disabler$3.apply(this.clearAvatarURLButton);
        }
    }


    setAvatarVideo(v) {
        if (v !== null) {
            this.useVideoAvatarButton.innerHTML = "Remove video";
        }
        else {
            this.useVideoAvatarButton.innerHTML = "Use video";
        }
    }

    get inputBinding() {
        const self = selfs$2.get(this);
        return self.inputBinding.clone();
    }

    set inputBinding(value) {
        const self = selfs$2.get(this);
        for (let id of Object.getOwnPropertyNames(value)) {
            if (self.inputBinding[id] !== undefined
                && value[id] !== undefined
                && this[id] != undefined) {
                self.inputBinding[id]
                    = this[id].value
                    = value[id];
            }
        }
    }

    get gamepads() {
        return this.gpSelect.values;
    }

    set gamepads(values) {
        const disable = values.length === 0;
        this.gpSelect.values = values;
        setLocked(this.gpAxisLeftRight, disable);
        setLocked(this.gpAxisUpDown, disable);
        setLocked(this.gpButtonUp, disable);
        setLocked(this.gpButtonDown, disable);
        setLocked(this.gpButtonLeft, disable);
        setLocked(this.gpButtonRight, disable);
        setLocked(this.gpButtonEmote, disable);
        setLocked(this.gpButtonToggleAudio, disable);
    }

    get currentGamepadIndex() {
        return this.gpSelect.selectedIndex;
    }

    get currentGamepad() {
        if (this.currentGamepadIndex < 0) {
            return null;
        }
        else {
            return navigator.getGamepads()[this.currentGamepadIndex];
        }
    }

    get gamepadIndex() {
        return this.gpSelect.selectedIndex;
    }

    set gamepadIndex(value) {
        this.gpSelect.selectedIndex = value;
    }

    get drawHearing() {
        return this._drawHearing;
    }

    set drawHearing(value) {
        this._drawHearing = value;
        this.drawHearingCheck.checked = value;
    }

    get audioDistanceMin() {
        const value = parseFloat(this.audioMinInput.value);
        if (isGoodNumber(value)) {
            return value;
        }
        else {
            return 1;
        }
    }

    set audioDistanceMin(value) {
        if (isGoodNumber(value)
            && value > 0) {
            this.audioMinInput.value = value;
            if (this.audioDistanceMin > this.audioDistanceMax) {
                this.audioDistanceMax = this.audioDistanceMin;
            }
        }
    }


    get audioDistanceMax() {
        const value = parseFloat(this.audioMaxInput.value);
        if (isGoodNumber(value)) {
            return value;
        }
        else {
            return 10;
        }
    }

    set audioDistanceMax(value) {
        if (isGoodNumber(value)
            && value > 0) {
            this.audioMaxInput.value = value;
            if (this.audioDistanceMin > this.audioDistanceMax) {
                this.audioDistanceMin = this.audioDistanceMax;
            }
        }
    }


    get audioRolloff() {
        const value = parseFloat(this.audioRolloffInput.value);
        if (isGoodNumber(value)) {
            return value;
        }
        else {
            return 1;
        }
    }

    set audioRolloff(value) {
        if (isGoodNumber(value)
            && value > 0) {
            this.audioRolloffInput.value = value;
        }
    }


    get fontSize() {
        const value = parseFloat(this.fontSizeInput.value);
        if (isGoodNumber(value)) {
            return value;
        }
        else {
            return 16;
        }
    }

    set fontSize(value) {
        if (isGoodNumber(value)
            && value > 0) {
            this.fontSizeInput.value = value;
        }
    }
}

const newRowColor = backgroundColor("lightgreen");
const hoveredColor = backgroundColor("rgba(65, 255, 202, 0.25)");
const unhoveredColor = backgroundColor("transparent");
const warpToEvt = Object.assign(
    new Event("warpTo"),
    {
        id: null
    });

const chatFocusChanged = new Event("chatFocusChanged");

const ROW_TIMEOUT = 3000;

class UserDirectoryForm extends FormDialog {

    constructor() {
        super("users");

        this.roomName = null;
        this.userName = null;
        this.chatFocused = false;
        this.usersList = Div(id("chatUsers"));
        this.messages = Div(id("chatMessages"));

        /** @type {Map.<string, Element[]>} */
        this.rows = new Map();

        /** @type {Map<string, User>} */
        this.users = new Map();

        /** @type {Map<string, CanvasRenderingContext2D>} */
        this.avatarGs = new Map();

        //this.chat.on("ReceiveMessage", (room, user, message) => {
        //    if (user !== lastUser) {
        //        lastUser = user;
        //        user = "";
        //    }

        //    this.messages.append(Div(user), Div(message));
        //    this.messages.lastChild.scrollIntoView();
        //});

        const sendMessage = async () => {
            if (this.entry.value.length > 0) {
                this.send.disabled
                    = this.entry.disabled
                    = true;
                //await this.chat.invoke("SendMessage", this.roomName, this.userName, this.entry.value);
                this.entry.value = "";
                this.entry.disabled
                    = this.send.disabled
                    = false;
                this.entry.focus();
            }
        };

        const onFocusChanged = () => this.dispatchEvent(chatFocusChanged);

        this.entry = InputText(
            id("chatEntry"),
            disabled,
            onFocus(() => this.chatFocused = true),
            onFocus(onFocusChanged),
            onBlur(() => this.chatFocused = false),
            onBlur(onFocusChanged),
            onKeyPress((evt) => {
                if (evt.key === "Enter") {
                    sendMessage();
                }
            }));

        this.send = Button(
            id("chatSend"),
            disabled,
            onClick(sendMessage));

        Object.seal(this);
    }

    /**
     *
     * @param {string} roomName
     * @param {string} userName
     */
    async startAsync(roomName, userName) {
        this.roomName = roomName;
        this.userName = userName;
        //await this.chat.start();
        //await this.chat.invoke("Join", this.roomName);
        this.entry.disabled
            = this.send.disabled
            = false;
    }

    update() {
        if (isOpen(this)) {
            for (let entries of this.users.entries()) {
                const [id, user] = entries;
                if (this.avatarGs.has(id) && user.avatar) {
                    const g = this.avatarGs.get(id);
                    g.clearRect(0, 0, g.canvas.width, g.canvas.height);
                    user.avatar.draw(g, g.canvas.width, g.canvas.height);
                }
            }
        }
    }

    /**
     * 
     * @param {User} user
     */
    set(user) {
        const isNew = !this.rows.has(user.id);
        this.delete(user.id);
        const row = this.rows.size + 1;

        if (isNew) {
            const elem = Div(
                gridPos(1, row, 2, 1),
                zIndex(-1),
                newRowColor);
            setTimeout(() => {
                this.usersList.removeChild(elem);
            }, ROW_TIMEOUT);
            this.usersList.append(elem);
            this.users.set(user.id, user);
            this.avatarGs.set(
                user.id,
                Canvas(
                    width(32),
                    height(32))
                    .getContext("2d"));
        }

        const avatar = this.avatarGs.get(user.id).canvas;

        const elems = [
            Div(gridPos(1, row), zIndex(0), avatar),
            Div(gridPos(2, row), zIndex(0), user.displayName),
            Div(
                gridPos(1, row, 2, 1), zIndex(1),
                unhoveredColor,
                onMouseOver(function () {
                    hoveredColor.apply(this);
                }),
                onMouseOut(function () {
                    unhoveredColor.apply(this);
                }),
                onClick(() => {
                    hide(this);
                    warpToEvt.id = user.id;
                    this.dispatchEvent(warpToEvt);
                }))];

        this.rows.set(user.id, elems);
        this.usersList.append(...elems);
    }

    delete(userID) {
        if (this.rows.has(userID)) {
            const elems = this.rows.get(userID);
            this.rows.delete(userID);
            for (let elem of elems) {
                this.usersList.removeChild(elem);
            }

            let rowCount = 1;
            for (let elems of this.rows.values()) {
                const r = row(rowCount++);
                for (let elem of elems) {
                    r.apply(elem);
                }
            }
        }
    }

    clear() {
        for (let id of this.rows.keys()) {
            this.delete(id);
        }
    }

    warn(...rest) {
        const elem = Div(
            gridPos(1, this.rows.size + 1, 2, 1),
            backgroundColor("yellow"),
            ...rest.map(i => i.toString()));

        this.usersList.append(elem);

        setTimeout(() => {
            this.usersList.removeChild(elem);
        }, 5000);
    }
}

// javascript-astar 0.4.1
// http://github.com/bgrins/javascript-astar
// Freely distributable under the MIT License.
// Implements the astar search algorithm in javascript using a Binary Heap.
// Includes Binary Heap (with modifications) from Marijn Haverbeke.
// http://eloquentjavascript.net/appendix2.html

// edits to work with JS modules by STM/capnmidnight 2020-07-20

function pathTo(node) {
  var curr = node;
  var path = [];
  while (curr.parent) {
    path.unshift(curr);
    curr = curr.parent;
  }
  return path;
}

function getHeap() {
  return new BinaryHeap(function(node) {
    return node.f;
  });
}

var astar = {
  /**
  * Perform an A* Search on a graph given a start and end node.
  * @param {Graph} graph
  * @param {GridNode} start
  * @param {GridNode} end
  * @param {Object} [options]
  * @param {bool} [options.closest] Specifies whether to return the
             path to the closest node if the target is unreachable.
  * @param {Function} [options.heuristic] Heuristic function (see
  *          astar.heuristics).
  */
  search: function(graph, start, end, options) {
    graph.cleanDirty();
    options = options || {};
    var heuristic = options.heuristic || astar.heuristics.manhattan;
    var closest = options.closest || false;

    var openHeap = getHeap();
    var closestNode = start; // set the start node to be the closest if required

    start.h = heuristic(start, end);
    graph.markDirty(start);

    openHeap.push(start);

    while (openHeap.size() > 0) {

      // Grab the lowest f(x) to process next.  Heap keeps this sorted for us.
      var currentNode = openHeap.pop();

      // End case -- result has been found, return the traced path.
      if (currentNode === end) {
        return pathTo(currentNode);
      }

      // Normal case -- move currentNode from open to closed, process each of its neighbors.
      currentNode.closed = true;

      // Find all neighbors for the current node.
      var neighbors = graph.neighbors(currentNode);

      for (var i = 0, il = neighbors.length; i < il; ++i) {
        var neighbor = neighbors[i];

        if (neighbor.closed || neighbor.isWall()) {
          // Not a valid node to process, skip to next neighbor.
          continue;
        }

        // The g score is the shortest distance from start to current node.
        // We need to check if the path we have arrived at this neighbor is the shortest one we have seen yet.
        var gScore = currentNode.g + neighbor.getCost(currentNode);
        var beenVisited = neighbor.visited;

        if (!beenVisited || gScore < neighbor.g) {

          // Found an optimal (so far) path to this node.  Take score for node to see how good it is.
          neighbor.visited = true;
          neighbor.parent = currentNode;
          neighbor.h = neighbor.h || heuristic(neighbor, end);
          neighbor.g = gScore;
          neighbor.f = neighbor.g + neighbor.h;
          graph.markDirty(neighbor);
          if (closest) {
            // If the neighbour is closer than the current closestNode or if it's equally close but has
            // a cheaper path than the current closest node then it becomes the closest node
            if (neighbor.h < closestNode.h || (neighbor.h === closestNode.h && neighbor.g < closestNode.g)) {
              closestNode = neighbor;
            }
          }

          if (!beenVisited) {
            // Pushing to heap will put it in proper place based on the 'f' value.
            openHeap.push(neighbor);
          } else {
            // Already seen the node, but since it has been rescored we need to reorder it in the heap
            openHeap.rescoreElement(neighbor);
          }
        }
      }
    }

    if (closest) {
      return pathTo(closestNode);
    }

    // No result was found - empty array signifies failure to find path.
    return [];
  },
  // See list of heuristics: http://theory.stanford.edu/~amitp/GameProgramming/Heuristics.html
  heuristics: {
    manhattan: function(pos0, pos1) {
      var d1 = Math.abs(pos1.x - pos0.x);
      var d2 = Math.abs(pos1.y - pos0.y);
      return d1 + d2;
    },
    diagonal: function(pos0, pos1) {
      var D = 1;
      var D2 = Math.sqrt(2);
      var d1 = Math.abs(pos1.x - pos0.x);
      var d2 = Math.abs(pos1.y - pos0.y);
      return (D * (d1 + d2)) + ((D2 - (2 * D)) * Math.min(d1, d2));
    }
  },
  cleanNode: function(node) {
    node.f = 0;
    node.g = 0;
    node.h = 0;
    node.visited = false;
    node.closed = false;
    node.parent = null;
  }
};

/**
 * A graph memory structure
 * @param {Array} gridIn 2D array of input weights
 * @param {Object} [options]
 * @param {bool} [options.diagonal] Specifies whether diagonal moves are allowed
 */
function Graph(gridIn, options) {
  options = options || {};
  this.nodes = [];
  this.diagonal = !!options.diagonal;
  this.grid = [];
  for (var x = 0; x < gridIn.length; x++) {
    this.grid[x] = [];

    for (var y = 0, row = gridIn[x]; y < row.length; y++) {
      var node = new GridNode(x, y, row[y]);
      this.grid[x][y] = node;
      this.nodes.push(node);
    }
  }
  this.init();
}

Graph.prototype.init = function() {
  this.dirtyNodes = [];
  for (var i = 0; i < this.nodes.length; i++) {
    astar.cleanNode(this.nodes[i]);
  }
};

Graph.prototype.cleanDirty = function() {
  for (var i = 0; i < this.dirtyNodes.length; i++) {
    astar.cleanNode(this.dirtyNodes[i]);
  }
  this.dirtyNodes = [];
};

Graph.prototype.markDirty = function(node) {
  this.dirtyNodes.push(node);
};

Graph.prototype.neighbors = function(node) {
  var ret = [];
  var x = node.x;
  var y = node.y;
  var grid = this.grid;

  // West
  if (grid[x - 1] && grid[x - 1][y]) {
    ret.push(grid[x - 1][y]);
  }

  // East
  if (grid[x + 1] && grid[x + 1][y]) {
    ret.push(grid[x + 1][y]);
  }

  // South
  if (grid[x] && grid[x][y - 1]) {
    ret.push(grid[x][y - 1]);
  }

  // North
  if (grid[x] && grid[x][y + 1]) {
    ret.push(grid[x][y + 1]);
  }

  if (this.diagonal) {
    // Southwest
    if (grid[x - 1] && grid[x - 1][y - 1]) {
      ret.push(grid[x - 1][y - 1]);
    }

    // Southeast
    if (grid[x + 1] && grid[x + 1][y - 1]) {
      ret.push(grid[x + 1][y - 1]);
    }

    // Northwest
    if (grid[x - 1] && grid[x - 1][y + 1]) {
      ret.push(grid[x - 1][y + 1]);
    }

    // Northeast
    if (grid[x + 1] && grid[x + 1][y + 1]) {
      ret.push(grid[x + 1][y + 1]);
    }
  }

  return ret;
};

Graph.prototype.toString = function() {
  var graphString = [];
  var nodes = this.grid;
  for (var x = 0; x < nodes.length; x++) {
    var rowDebug = [];
    var row = nodes[x];
    for (var y = 0; y < row.length; y++) {
      rowDebug.push(row[y].weight);
    }
    graphString.push(rowDebug.join(" "));
  }
  return graphString.join("\n");
};

function GridNode(x, y, weight) {
  this.x = x;
  this.y = y;
  this.weight = weight;
}

GridNode.prototype.toString = function() {
  return "[" + this.x + " " + this.y + "]";
};

GridNode.prototype.getCost = function(fromNeighbor) {
  // Take diagonal weight into consideration.
  if (fromNeighbor && fromNeighbor.x != this.x && fromNeighbor.y != this.y) {
    return this.weight * 1.41421;
  }
  return this.weight;
};

GridNode.prototype.isWall = function() {
  return this.weight === 0;
};

function BinaryHeap(scoreFunction) {
  this.content = [];
  this.scoreFunction = scoreFunction;
}

BinaryHeap.prototype = {
  push: function(element) {
    // Add the new element to the end of the array.
    this.content.push(element);

    // Allow it to sink down.
    this.sinkDown(this.content.length - 1);
  },
  pop: function() {
    // Store the first element so we can return it later.
    var result = this.content[0];
    // Get the element at the end of the array.
    var end = this.content.pop();
    // If there are any elements left, put the end element at the
    // start, and let it bubble up.
    if (this.content.length > 0) {
      this.content[0] = end;
      this.bubbleUp(0);
    }
    return result;
  },
  remove: function(node) {
    var i = this.content.indexOf(node);

    // When it is found, the process seen in 'pop' is repeated
    // to fill up the hole.
    var end = this.content.pop();

    if (i !== this.content.length - 1) {
      this.content[i] = end;

      if (this.scoreFunction(end) < this.scoreFunction(node)) {
        this.sinkDown(i);
      } else {
        this.bubbleUp(i);
      }
    }
  },
  size: function() {
    return this.content.length;
  },
  rescoreElement: function(node) {
    this.sinkDown(this.content.indexOf(node));
  },
  sinkDown: function(n) {
    // Fetch the element that has to be sunk.
    var element = this.content[n];

    // When at 0, an element can not sink any further.
    while (n > 0) {

      // Compute the parent element's index, and fetch it.
      var parentN = ((n + 1) >> 1) - 1;
      var parent = this.content[parentN];
      // Swap the elements if the parent is greater.
      if (this.scoreFunction(element) < this.scoreFunction(parent)) {
        this.content[parentN] = element;
        this.content[n] = parent;
        // Update 'n' to continue at the new position.
        n = parentN;
      }
      // Found a parent that is less, no need to sink any further.
      else {
        break;
      }
    }
  },
  bubbleUp: function(n) {
    // Look up the target element and its score.
    var length = this.content.length;
    var element = this.content[n];
    var elemScore = this.scoreFunction(element);

    while (true) {
      // Compute the indices of the child elements.
      var child2N = (n + 1) << 1;
      var child1N = child2N - 1;
      // This is used to store the new position of the element, if any.
      var swap = null;
      var child1Score;
      // If the first child exists (is inside the array)...
      if (child1N < length) {
        // Look it up and compute its score.
        var child1 = this.content[child1N];
        child1Score = this.scoreFunction(child1);

        // If the score is less than our element's, we need to swap.
        if (child1Score < elemScore) {
          swap = child1N;
        }
      }

      // Do the same checks for the other child.
      if (child2N < length) {
        var child2 = this.content[child2N];
        var child2Score = this.scoreFunction(child2);
        if (child2Score < (swap === null ? elemScore : child1Score)) {
          swap = child2N;
        }
      }

      // If the element needs to be moved, swap it, and continue.
      if (swap !== null) {
        this.content[n] = this.content[swap];
        this.content[swap] = element;
        n = swap;
      }
      // Otherwise, we are done.
      else {
        break;
      }
    }
  }
};

class TileSet {
    constructor(url) {
        this.url = url;
        this.tileWidth = 0;
        this.tileHeight = 0;
        this.tilesPerRow = 0;
        this.image = new Image();
        this.collision = {};
    }

    async load() {
        const response = await fetch(this.url),
            text = await response.text(),
            parser = new DOMParser(),
            xml = parser.parseFromString(text, "text/xml"),
            tileset = xml.documentElement,
            imageLoad = new Promise((resolve, reject) => {
                this.image.addEventListener("load", (evt) => {
                    this.tilesPerRow = Math.floor(this.image.width / this.tileWidth);
                    resolve();
                });
                this.image.addEventListener("error", reject);
            }),
            image = tileset.querySelector("image"),
            imageSource = image.getAttribute("source"),
            imageURL = new URL(imageSource, this.url),
            tiles = tileset.querySelectorAll("tile");

        for (let tile of tiles) {
            const id = 1 * tile.getAttribute("id"),
                collid = tile.querySelector("properties > property[name='Collision']"),
                value = collid.getAttribute("value");
            this.collision[id] = value === "true";
        }

        this.name = tileset.getAttribute("name");
        this.tileWidth = 1 * tileset.getAttribute("tilewidth");
        this.tileHeight = 1 * tileset.getAttribute("tileheight");
        this.tileCount = 1 * tileset.getAttribute("tilecount");
        this.image.src = imageURL.href;
        await imageLoad;
    }

    isClear(tile) {
        return !this.collision[tile - 1];
    }

    draw(g, tile, x, y) {
        if (tile > 0) {
            const idx = tile - 1,
                sx = this.tileWidth * (idx % this.tilesPerRow),
                sy = this.tileHeight * Math.floor(idx / this.tilesPerRow),
                dx = x * this.tileWidth,
                dy = y * this.tileHeight;

            g.drawImage(this.image,
                sx, sy, this.tileWidth, this.tileHeight,
                dx, dy, this.tileWidth, this.tileHeight);
        }
    }
}

/** @type {WeakMap<TileMap, TileMapPrivate>} */
const selfs$3 = new WeakMap();

class TileMapPrivate {
    constructor(tilemapName) {
        this.url = new URL(`data/tilemaps/${tilemapName}.tmx`, document.baseURI);
        this.tileWidth = 0;
        this.tileHeight = 0;
        this.layers = 0;
        this.width = 0;
        this.height = 0;
        this.offsetX = 0;
        this.offsetY = 0;

        /** @type {TileSet} */
        this.tileset = null;

        /** @type {number[][][]} */
        this.tiles = null;

        /** @type {Graph} */
        this.graph = null;

        /** @type {OffscreenCanvas[]} */
        this.layerImages = [];

        Object.seal(this);
    }
}

class TileMap {
    constructor(tilemapName) {
        selfs$3.set(this, new TileMapPrivate(tilemapName));
    }

    async load() {
        const self = selfs$3.get(this),
            response = await fetch(self.url.href);
        if (!response.ok) {
            throw new Error(`Failed to load TileMap from ${self.url.href}. Reason: [${response.status}] ${response.statusText}`);
        }

        const text = await response.text(),
            parser = new DOMParser(),
            xml = parser.parseFromString(text, "text/xml"),
            map = xml.documentElement,
            width = 1 * map.getAttribute("width"),
            height = 1 * map.getAttribute("height"),
            tileWidth = 1 * map.getAttribute("tilewidth"),
            tileHeight = 1 * map.getAttribute("tileheight"),
            tileset = map.querySelector("tileset"),
            tilesetSource = tileset.getAttribute("source"),
            layers = map.querySelectorAll("layer > data");

        self.layers = layers.length;
        self.width = width;
        self.height = height;
        self.offsetX = -Math.floor(width / 2);
        self.offsetY = -Math.floor(height / 2);
        self.tileWidth = tileWidth;
        self.tileHeight = tileHeight;

        self.tiles = [];
        for (let layer of layers) {
            const tileIds = layer.innerHTML
                .replace(" ", "")
                .replace("\t", "")
                .replace("\n", "")
                .replace("\r", "")
                .split(",")
                .map(s => parseInt(s, 10)),
                rows = [];
            let row = [];
            for (let tile of tileIds) {
                row.push(tile);
                if (row.length === width) {
                    rows.push(row);
                    row = [];
                }
            }
            if (row.length > 0) {
                rows.push(row);
            }

            self.tiles.push(rows);
        }

        self.tileset = new TileSet(new URL(tilesetSource, self.url));
        await self.tileset.load();
        self.tileWidth = self.tileset.tileWidth;
        self.tileHeight = self.tileset.tileHeight;

        for (let l = 0; l < self.layers; ++l) {
            const img = CanvasOffscreen(this.width * this.tileWidth, this.height * this.tileHeight);
            self.layerImages.push(img);
            const context = img.getContext("2d");
            const layer = self.tiles[l];
            for (let y = 0; y < this.height; ++y) {
                const row = layer[y];
                for (let x = 0; x < this.width; ++x) {
                    const tile = row[x];
                    self.tileset.draw(context, tile, x, y);
                }
            }
        }

        let grid = [];
        for (let row of self.tiles[0]) {
            let gridrow = [];
            for (let tile of row) {
                if (self.tileset.isClear(tile)) {
                    gridrow.push(1);
                } else {
                    gridrow.push(0);
                }
            }
            grid.push(gridrow);
        }
        self.graph = new Graph(grid, { diagonal: true });
    }

    get width() {
        return selfs$3.get(this).width;
    }

    get height() {
        return selfs$3.get(this).height;
    }

    get tileWidth() {
        return selfs$3.get(this).tileWidth;
    }

    get tileHeight() {
        return selfs$3.get(this).tileHeight;
    }

    isInBounds(x, y) {
        return 0 <= x && x < this.width
            && 0 <= y && y < this.height;
    }

    getGridNode(x, y) {
        const self = selfs$3.get(this);
        x -= self.offsetX;
        y -= self.offsetY;
        x = Math.round(x);
        y = Math.round(y);
        if (this.isInBounds(x, y)) {
            return self.graph.grid[y][x];
        }
        else {
            return null;
        }
    }

    draw(g) {
        const self = selfs$3.get(this);
        g.save();
        {
            g.translate(self.offsetX * this.tileWidth, self.offsetY * this.tileHeight);
            for (let img of self.layerImages) {
                g.drawImage(img, 0, 0);
            }
        }
        g.restore();
    }

    searchPath(start, end) {
        const self = selfs$3.get(this);
        return astar.search(self.graph, start, end)
            .map(p => {
                return {
                    x: p.y + self.offsetX,
                    y: p.x + self.offsetY
                };
            });
    }

    isClear(x, y, avatar) {
        const self = selfs$3.get(this);
        x -= self.offsetX;
        y -= self.offsetY;
        x = Math.round(x);
        y = Math.round(y);
        return x < 0 || this.width <= x
            || y < 0 || this.height <= y
            || self.tileset && self.tileset.isClear(self.tiles[0][y][x])
            || avatar && avatar.canSwim;
    }

    // Use Bresenham's line algorithm (with integer error)
    // to draw a line through the map, cutting it off if
    // it hits a wall.
    getClearTile(x, y, dx, dy, avatar) {
        const x1 = x + dx,
            y1 = y + dy,
            sx = x < x1 ? 1 : -1,
            sy = y < y1 ? 1 : -1;

        dx = Math.abs(x1 - x);
        dy = Math.abs(y1 - y);

        let err = (dx > dy ? dx : -dy) / 2;

        while (x !== x1
            || y !== y1) {
            const e2 = err;
            if (e2 > -dx) {
                if (this.isClear(x + sx, y, avatar)) {
                    err -= dy;
                    x += sx;
                }
                else {
                    break;
                }
            }
            if (e2 < dy) {
                if (this.isClear(x, y + sy, avatar)) {
                    err += dx;
                    y += sy;
                }
                else {
                    break;
                }
            }
        }

        return { x, y };
    }

    getClearTileNear(x, y, maxRadius, avatar) {
        for (let r = 1; r <= maxRadius; ++r) {
            for (let dx = -r; dx <= r; ++dx) {
                const dy = r - Math.abs(dx);
                const tx = x + dx;
                const ty1 = y + dy;
                const ty2 = y - dy;

                if (this.isClear(tx, ty1, avatar)) {
                    return { x: tx, y: ty1 };
                }
                else if (this.isClear(tx, ty2, avatar)) {
                    return { x: tx, y: ty2 };
                }
            }
        }

        return { x, y };
    }
}

class ScreenPointerEvent extends Event {
    constructor(type) {
        super(type);

        this.pointerType = null;
        this.pointerID = null;
        this.x = 0;
        this.y = 0;
        this.dx = 0;
        this.dy = 0;
        this.dz = 0;
        this.u = 0;
        this.v = 0;
        this.du = 0;
        this.dv = 0;
        this.buttons = 0;
        this.dragDistance = 0;

        Object.seal(this);
    }
}

class InputTypeChangingEvent extends Event {
    /**
     * @param {String} inputType
     */
    constructor(inputType) {
        super("inputtypechanging");
        this.newInputType = inputType;

        Object.freeze(this);
    }
}

class Pointer {
    /**
     * @param {PointerEvent} evt
     */
    constructor(evt) {
        this.type = evt.pointerType;
        this.id = evt.pointerId;
        this.buttons = evt.buttons;
        this.moveDistance = 0;
        this.dragDistance = 0;
        this.x = evt.offsetX;
        this.y = evt.offsetY;
        this.dx = evt.movementX;
        this.dy = evt.movementY;

        Object.seal(this);
    }
}

const MAX_DRAG_DISTANCE = 5,
    pointerDownEvt = new ScreenPointerEvent("pointerdown"),
    pointerUpEvt = new ScreenPointerEvent("pointerup"),
    clickEvt = new ScreenPointerEvent("click"),
    moveEvt = new ScreenPointerEvent("move"),
    dragEvt = new ScreenPointerEvent("drag");

class ScreenPointerControls extends EventBase {
    /**
     * @param {Element} element the element from which to receive pointer events
     */
    constructor(element) {
        super();

        /** @type {Map<Number, Pointer>} */
        this.pointers = new Map();

        /** @type {String} */
        this.currentInputType = null;

        let canClick = true;

        /**
         * @param {ScreenPointerEvent} evt
         * @param {Pointer} pointer
         */
        const dispatch = (evt, pointer, dz) => {

            evt.pointerType = pointer.type;
            evt.pointerID = pointer.id;

            evt.buttons = pointer.buttons;

            evt.x = pointer.x;
            evt.y = pointer.y;

            evt.u = unproject(project(evt.x, 0, element.clientWidth), -1, 1);
            evt.v = unproject(project(evt.y, 0, element.clientHeight), -1, 1);

            evt.dx = pointer.dx;
            evt.dy = pointer.dy;
            evt.dz = dz;

            evt.du = 2 * evt.dx / element.clientWidth;
            evt.dv = 2 * evt.dy / element.clientHeight;

            evt.dragDistance = pointer.dragDistance;
            this.dispatchEvent(evt);
        };

        /**
         * @param {Pointer} pointer - the newest state of the pointer.
         * @returns {Pointer} - the pointer state that was replaced, if any.
         */
        const replacePointer = (pointer) => {
            const last = this.pointers.get(pointer.id);

            if (last) {
                pointer.dragDistance = last.dragDistance;

                if (document.pointerLockElement) {
                    pointer.x = last.x + pointer.dx;
                    pointer.y = last.y + pointer.dy;
                }
            }

            pointer.moveDistance = Math.sqrt(
                pointer.dx * pointer.dx
                + pointer.dy * pointer.dy);

            this.pointers.set(pointer.id, pointer);

            return last;
        };

        element.addEventListener("wheel", (evt) => {
            if (!evt.shiftKey
                && !evt.altKey
                && !evt.ctrlKey
                && !evt.metaKey) {

                evt.preventDefault();

                // Chrome and Firefox report scroll values in completely different ranges.
                const pointer = new Pointer(evt),
                    _ = replacePointer(pointer),
                    deltaZ = -evt.deltaY * (isFirefox ? 1 : 0.02);

                dispatch(moveEvt, pointer, deltaZ);
            }
        }, { passive: false });

        element.addEventListener("pointerdown", (evt) => {
            const oldCount = this.pressCount,
                pointer = new Pointer(evt),
                _ = replacePointer(pointer),
                newCount = this.pressCount;

            if (pointer.type !== this.currentInputType) {
                this.dispatchEvent(new InputTypeChangingEvent(pointer.type));
                this.currentInputType = pointer.type;
            }

            dispatch(pointerDownEvt, pointer, 0);

            canClick = oldCount === 0
                && newCount === 1;
        });

        /**
         * @param {number} oldPinchDistance
         * @param {number} newPinchDistance
         * @returns {number}
         */
        const getPinchZoom = (oldPinchDistance, newPinchDistance) => {
            if (oldPinchDistance !== null
                && newPinchDistance !== null) {
                canClick = false;
                const ddist = newPinchDistance - oldPinchDistance;
                return ddist / 10;
            }

            return 0;
        };

        element.addEventListener("pointermove", (evt) => {
            const oldPinchDistance = this.pinchDistance,
                pointer = new Pointer(evt),
                last = replacePointer(pointer),
                count = this.pressCount,
                dz = getPinchZoom(oldPinchDistance, this.pinchDistance);

            dispatch(moveEvt, pointer, dz);

            if (count === 1
                && pointer.buttons === 1
                && last && last.buttons === pointer.buttons) {
                pointer.dragDistance += pointer.moveDistance;
                if (pointer.dragDistance > MAX_DRAG_DISTANCE) {
                    canClick = false;
                    dispatch(dragEvt, pointer, 0);
                }
            }
        });

        element.addEventListener("pointerup", (evt) => {
            const pointer = new Pointer(evt),
                lastPointer = replacePointer(pointer);

            pointer.buttons = lastPointer.buttons;

            dispatch(pointerUpEvt, pointer, 0);

            if (canClick) {
                dispatch(clickEvt, pointer, 0);
            }

            pointer.dragDistance = 0;

            if (pointer.type === "touch") {
                this.pointers.delete(pointer.id);
            }
        });

        element.addEventListener("contextmenu", (evt) => {
            evt.preventDefault();
        });

        element.addEventListener("pointercancel", (evt) => {
            if (this.pointers.has(evt.pointerId)) {
                this.pointers.delete(evt.pointerId);
            }
        });
    }

    get primaryPointer() {
        for (let pointer of this.pointers.values()) {
            return pointer;
        }
    }

    getPointerCount(type) {
        let count = 0;
        for (const pointer of this.pointers.values()) {
            if (pointer.type === type) {
                ++count;
            }
        }
        return count;
    }

    get pressCount() {
        let count = 0;
        for (let pointer of this.pointers.values()) {
            if (pointer.buttons > 0) {
                ++count;
            }
        }
        return count;
    }

    get pinchDistance() {
        const count = this.pressCount;
        if (count !== 2) {
            return null;
        }

        let a, b;
        for (let pointer of this.pointers.values()) {
            if (pointer.buttons === 1) {
                if (!a) {
                    a = pointer;
                }
                else if (!b) {
                    b = pointer;
                }
                else {
                    break;
                }
            }
        }

        const dx = b.x - a.x,
            dy = b.y - a.y;

        return Math.sqrt(dx * dx + dy * dy);
    }
}

const EMOJI_LIFE = 3;

class Emote {
    constructor(emoji, x, y) {
        this.emoji = emoji;
        this.x = x;
        this.y = y;
        this.dx = Math.random() - 0.5;
        this.dy = -Math.random() * 0.5 - 0.5;
        this.life = 1;
        this.width = -1;
        this.emoteText = new TextImage();
        this.emoteText.fontFamily = "Noto Color Emoji";
        this.emoteText.value = emoji.value;
    }

    isDead() {
        return this.life <= 0.01;
    }

    update(dt) {
        this.life -= dt / EMOJI_LIFE;
        this.dx *= 0.99;
        this.dy *= 0.99;
        this.x += this.dx * dt;
        this.y += this.dy * dt;
    }

    drawShadow(g, map) {
        const scale = getTransform(g).a;
        g.save();
        {
            g.shadowColor = "rgba(0, 0, 0, 0.5)";
            g.shadowOffsetX = 3 * scale;
            g.shadowOffsetY = 3 * scale;
            g.shadowBlur = 3 * scale;

            this.drawEmote(g, map);
        }
        g.restore();
    }

    /**
     * 
     * @param {CanvasRenderingContext2D} g
     * @param {any} map
     */
    drawEmote(g, map) {
        const oldAlpha = g.globalAlpha,
            scale = getTransform(g).a;
        g.globalAlpha = this.life;
        this.emoteText.fontSize = map.tileHeight / 2;
        this.emoteText.scale = scale;
        this.emoteText.draw(g,
            this.x * map.tileWidth - this.width / 2,
            this.y * map.tileHeight);
        g.globalAlpha = oldAlpha;
    }
}

const CAMERA_LERP = 0.01,
    CAMERA_ZOOM_SHAPE = 2,
    MOVE_REPEAT = 0.125,
    gameStartedEvt = new Event("gameStarted"),
    gameEndedEvt = new Event("gameEnded"),
    zoomChangedEvt$1 = new Event("zoomChanged"),
    emojiNeededEvt = new Event("emojiNeeded"),
    toggleAudioEvt$1 = new Event("toggleAudio"),
    toggleVideoEvt$2 = new Event("toggleVideo"),
    moveEvent = Object.assign(new Event("userMoved"), {
        x: 0,
        y: 0
    }),
    emoteEvt$1 = Object.assign(new Event("emote"), {
        emoji: null
    }),
    userJoinedEvt = Object.assign(new Event("userJoined", {
        user: null
    }));

/** @type {Map<Game, EventedGamepad>} */
const gamepads = new Map();

class Game extends EventBase {

    constructor(zoomMin, zoomMax) {
        super();

        this.zoomMin = zoomMin;
        this.zoomMax = zoomMax;

        this.element = Canvas(id("frontBuffer"));
        this.gFront = this.element.getContext("2d");

        /** @type {User} */
        this.me = null;

        /** @type {TileMap} */
        this.map = null;

        this.waypoints = [];

        this.keys = {};

        /** @type {Map.<string, User>} */
        this.users = new Map();

        this.lastMove = Number.MAX_VALUE;
        this.lastWalk = Number.MAX_VALUE;
        this.gridOffsetX = 0;
        this.gridOffsetY = 0;
        this.cameraX = this.offsetCameraX = this.targetOffsetCameraX = 0;
        this.cameraY = this.offsetCameraY = this.targetOffsetCameraY = 0;
        this.cameraZ = this.targetCameraZ = 1.5;
        this.currentRoomName = null;
        this.fontSize = 10;

        this.drawHearing = false;
        this.audioDistanceMin = 2;
        this.audioDistanceMax = 10;
        this.rolloff = 5;

        this.currentEmoji = null;

        /** @type {Emote[]} */
        this.emotes = [];

        this.inputBinding = {
            keyButtonUp: "ArrowUp",
            keyButtonDown: "ArrowDown",
            keyButtonLeft: "ArrowLeft",
            keyButtonRight: "ArrowRight",
            keyButtonEmote: "e",
            keyButtonToggleAudio: "a",
            keyButtonZoomOut: "[",
            keyButtonZoomIn: "]",

            gpAxisLeftRight: 0,
            gpAxisUpDown: 1,

            gpButtonEmote: 0,
            gpButtonToggleAudio: 1,
            gpButtonZoomIn: 6,
            gpButtonZoomOut: 7,
            gpButtonUp: 12,
            gpButtonDown: 13,
            gpButtonLeft: 14,
            gpButtonRight: 15
        };

        this.lastGamepadIndex = -1;
        this.gamepadIndex = -1;
        this.transitionSpeed = 0.125;
        this.keyboardEnabled = true;


        // ============= KEYBOARD =================

        addEventListener("keydown", (evt) => {
            this.keys[evt.key] = evt;
            if (this.keyboardEnabled
                && !evt.ctrlKey
                && !evt.altKey
                && !evt.shiftKey
                && !evt.metaKey
                && evt.key === this.inputBinding.keyButtonToggleAudio
                && !!this.me) {
                this.toggleMyAudio();
            }
        });

        addEventListener("keyup", (evt) => {
            if (this.keys[evt.key]) {
                delete this.keys[evt.key];
            }
        });

        // ============= KEYBOARD =================

        // ============= POINTERS =================
        this.screenControls = new ScreenPointerControls(this.element);
        addEventListeners(this.screenControls, {
            move: (evt) => {
                if (Math.abs(evt.dz) > 0) {
                    this.zoom += evt.dz;
                    this.dispatchEvent(zoomChangedEvt$1);
                }
            },
            drag: (evt) => {
                this.targetOffsetCameraX = this.offsetCameraX += evt.dx;
                this.targetOffsetCameraY = this.offsetCameraY += evt.dy;
            },
            click: (evt) => {
                if (!!this.me) {
                    const tile = this.getTileAt(evt),
                        dx = tile.x - this.me.gridX,
                        dy = tile.y - this.me.gridY;

                    this.moveMeByPath(dx, dy);
                }
            }
        });
        // ============= POINTERS =================

        // ============= ACTION ==================
    }

    get style() {
        return this.element.style;
    }

    initializeUser(id, evt) {
        this.withUser("initialize user", id, (user) => {
            user.deserialize(evt);
        });
    }

    updateAudioActivity(id, isActive) {
        this.withUser("update audio activity", id, (user) => {
            user.isActive = isActive;
        });
    }

    emote(id, emoji) {
        if (this.users.has(id)) {
            const user = this.users.get(id);
            if (user.isMe) {

                emoji = emoji
                    || this.currentEmoji;

                if (!emoji) {
                    this.dispatchEvent(emojiNeededEvt);
                }
                else {
                    emoteEvt$1.emoji = this.currentEmoji = emoji;
                    this.dispatchEvent(emoteEvt$1);
                }
            }

            if (emoji) {
                this.emotes.push(new Emote(emoji, user.x, user.y));
            }
        }
    }

    getTileAt(cursor) {
        const imageX = cursor.x * devicePixelRatio - this.gridOffsetX - this.offsetCameraX,
            imageY = cursor.y * devicePixelRatio - this.gridOffsetY - this.offsetCameraY,
            zoomX = imageX / this.cameraZ,
            zoomY = imageY / this.cameraZ,
            mapX = zoomX - this.cameraX,
            mapY = zoomY - this.cameraY,
            gridX = mapX / this.map.tileWidth,
            gridY = mapY / this.map.tileHeight,
            tile = { x: gridX - 0.5, y: gridY - 0.5 };
        return tile;
    }

    moveMeTo(x, y) {
        if (this.map.isClear(x, y, this.me.avatar)) {
            this.targetOffsetCameraX = 0;
            this.targetOffsetCameraY = 0;
            moveEvent.x = x;
            moveEvent.y = y;
            this.dispatchEvent(moveEvent);
        }
    }

    moveMeBy(dx, dy) {
        const clearTile = this.map.getClearTile(this.me.gridX, this.me.gridY, dx, dy, this.me.avatar);
        this.moveMeTo(clearTile.x, clearTile.y);
    }

    moveMeByPath(dx, dy) {
        arrayClear(this.waypoints);

        const x = this.me.gridX,
            y = this.me.gridY,
            start = this.map.getGridNode(x, y),
            tx = x + dx,
            ty = y + dy,
            gx = Math.round(tx),
            gy = Math.round(ty),
            ox = tx - gx,
            oy = ty - gy,
            end = this.map.getGridNode(tx, ty);

        if (!start || !end) {
            this.moveMeTo(tx, ty);
        }
        else {
            const result = this.map.searchPath(start, end);
            if (result.length === 0) {
                this.moveMeTo(tx, ty);
            }
            else {
                for (let point of result) {
                    point.x += ox;
                    point.y += oy;
                }
                this.waypoints.push(...result);
            }
        }
    }

    warpMeTo(x, y) {
        const clearTile = this.map.getClearTileNear(x, y, 3, this.me.avatar);
        this.moveMeTo(clearTile.x, clearTile.y);
    }

    visit(id) {
        this.withUser("visit", id, (user) => {
            this.warpMeTo(user.gridX, user.gridY);
        });
    }

    get zoom() {
        const a = project(this.targetCameraZ, this.zoomMin, this.zoomMax),
            b = Math.pow(a, 1 / CAMERA_ZOOM_SHAPE),
            c = unproject(b, this.zoomMin, this.zoomMax);
        return c;
    }

    set zoom(v) {
        v = clamp(v, this.zoomMin, this.zoomMax);

        const a = project(v, this.zoomMin, this.zoomMax),
            b = Math.pow(a, CAMERA_ZOOM_SHAPE),
            c = unproject(b, this.zoomMin, this.zoomMax);
        this.targetCameraZ = c;
    }

    /**
     * 
     * @param {string} id
     * @param {string} displayName
     * @param {import("../calla").InterpolatedPose} pose
     */
    addUser(id, displayName, pose) {
        if (this.users.has(id)) {
            this.removeUser(id);
        }

        const user = new User(id, displayName, pose, false);
        this.users.set(id, user);

        userJoinedEvt.user = user;
        this.dispatchEvent(userJoinedEvt);
    }

    toggleMyAudio() {
        this.dispatchEvent(toggleAudioEvt$1);
    }

    toggleMyVideo() {
        this.dispatchEvent(toggleVideoEvt$2);
    }

    muteUserAudio(id, muted) {
        this.withUser("mute audio", id, (user) => {
            user.audioMuted = muted;
        });
    }

    muteUserVideo(id, muted) {
        this.withUser("mute video", id, (user) => {
            user.videoMuted = muted;
        });
    }

    /**
    * Used to perform on operation when a valid user object is found.
    * @callback withUserCallback
    * @param {User} user
    * @returns {void}
    */

    /**
     * Find a user by id, then perform an operation on it.
     * @param {string} msg
     * @param {string} id
     * @param {withUserCallback} callback
     * @param {number} timeout
     */
    withUser(msg, id, callback, timeout) {
        if (timeout === undefined) {
            timeout = 5000;
        }
        if (id) {
            if (this.users.has(id)) {
                const user = this.users.get(id);
                callback(user);
            }
            else {
                console.warn(`No user "${id}" found to ${msg}. Trying again in a quarter second.`);
                if (timeout > 0) {
                    setTimeout(this.withUser.bind(this, msg, id, callback, timeout - 250), 250);
                }
            }
        }
    }

    changeUserName(id, displayName) {
        this.withUser("change user name", id, (user) => {
            user.displayName = displayName;
        });
    }

    removeUser(id) {
        if (this.users.has(id)) {
            this.users.delete(id);
        }
    }

    setAvatarVideo(id, stream) {
        this.withUser("set avatar video", id, (user) => {
            user.setAvatarVideo(stream);
        });
    }

    setAvatarURL(id, url) {
        this.withUser("set avatar image", id, (user) => {
            user.avatarImage = url;
        });
    }

    setAvatarEmoji(id, emoji) {
        this.withUser("set avatar emoji", id, (user) => {
            user.avatarEmoji = emoji;
        });
    }

    /**
     * 
     * @param {string} id
     * @param {string} displayName
     * @param {import("../calla").InterpolatedPose} pose
     * @param {string} avatarURL
     * @param {string} roomName
     */
    async startAsync(id, displayName, pose, avatarURL, roomName) {
        this.currentRoomName = roomName.toLowerCase();
        this.me = new User(id, displayName, pose, true);
        if (isString(avatarURL)) {
            this.me.avatarImage = avatarURL;
        }
        this.users.set(id, this.me);

        this.map = new TileMap(this.currentRoomName);
        let success = false;
        for (let retryCount = 0; retryCount < 2; ++retryCount) {
            try {
                await this.map.load();
                success = true;
            }
            catch (exp) {
                if (retryCount === 0) {
                    console.warn(exp);
                    console.warn("Retrying with default map.");
                    this.map = new TileMap("default");
                }
                else {
                    console.error(exp);
                }
            }
        }

        if (!success) {
            console.error("Couldn't load any maps!");
        }

        this.startLoop();
        this.dispatchEvent(zoomChangedEvt$1);
        this.dispatchEvent(gameStartedEvt);
    }

    startLoop() {
        show(this);
        this.resize();
        this.element.focus();
    }

    resize() {
        resizeCanvas(this.element, window.devicePixelRatio);
    }

    end() {
        this.currentRoomName = null;
        this.map = null;
        this.users.clear();
        this.me = null;
        hide(this);
        this.dispatchEvent(gameEndedEvt);
    }

    update(dt) {
        if (this.currentRoomName !== null) {
            dt /= 1000;
            this.gridOffsetX = Math.floor(0.5 * this.element.width / this.map.tileWidth) * this.map.tileWidth;
            this.gridOffsetY = Math.floor(0.5 * this.element.height / this.map.tileHeight) * this.map.tileHeight;

            this.lastMove += dt;
            if (this.lastMove >= MOVE_REPEAT) {
                let dx = 0,
                    dy = 0,
                    dz = 0;

                if (this.keyboardEnabled) {
                    for (let evt of Object.values(this.keys)) {
                        if (!evt.altKey
                            && !evt.shiftKey
                            && !evt.ctrlKey
                            && !evt.metaKey) {
                            switch (evt.key) {
                                case this.inputBinding.keyButtonUp: dy--; break;
                                case this.inputBinding.keyButtonDown: dy++; break;
                                case this.inputBinding.keyButtonLeft: dx--; break;
                                case this.inputBinding.keyButtonRight: dx++; break;
                                case this.inputBinding.keyButtonZoomIn: dz++; break;
                                case this.inputBinding.keyButtonZoomOut: dz--; break;
                                case this.inputBinding.keyButtonEmote: this.emote(this.me.id, this.currentEmoji); break;
                            }
                        }
                    }
                }

                const gp = navigator.getGamepads()[this.gamepadIndex];
                if (gp) {
                    if (!gamepads.has(this)) {
                        gamepads.set(this, new EventedGamepad(gp));
                    }

                    const pad = gamepads.get(this);
                    pad.update(gp);

                    if (pad.buttons[this.inputBinding.gpButtonEmote].pressed) {
                        this.emote(this.me.id, this.currentEmoji);
                    }

                    if (!pad.lastButtons[this.inputBinding.gpButtonToggleAudio].pressed
                        && pad.buttons[this.inputBinding.gpButtonToggleAudio].pressed) {
                        this.toggleMyAudio();
                    }

                    if (pad.buttons[this.inputBinding.gpButtonUp].pressed) {
                        --dy;
                    }
                    else if (pad.buttons[this.inputBinding.gpButtonDown].pressed) {
                        ++dy;
                    }

                    if (pad.buttons[this.inputBinding.gpButtonLeft].pressed) {
                        --dx;
                    }
                    else if (pad.buttons[this.inputBinding.gpButtonRight].pressed) {
                        ++dx;
                    }

                    dx += Math.round(pad.axes[this.inputBinding.gpAxisLeftRight]);
                    dy += Math.round(pad.axes[this.inputBinding.gpAxisUpDown]);
                    dz += 2 * (pad.buttons[this.inputBinding.gpButtonZoomIn].value - pad.buttons[this.inputBinding.gpButtonZoomOut].value);

                    this.targetOffsetCameraX += -50 * Math.round(2 * pad.axes[2]);
                    this.targetOffsetCameraY += -50 * Math.round(2 * pad.axes[3]);
                    this.dispatchEvent(zoomChangedEvt$1);
                }

                dx = clamp(dx, -1, 1);
                dy = clamp(dy, -1, 1);

                if (dx !== 0
                    || dy !== 0) {
                    this.moveMeBy(dx, dy);
                    arrayClear(this.waypoints);
                }

                if (dz !== 0) {
                    this.zoom += dz;
                    this.dispatchEvent(zoomChangedEvt$1);
                }

                this.lastMove = 0;
            }

            this.lastWalk += dt;
            if (this.lastWalk >= this.transitionSpeed) {
                if (this.waypoints.length > 0) {
                    const waypoint = this.waypoints.shift();
                    this.moveMeTo(waypoint.x, waypoint.y);
                }

                this.lastWalk = 0;
            }

            for (let emote of this.emotes) {
                emote.update(dt);
            }

            this.emotes = this.emotes.filter(e => !e.isDead());

            for (let user of this.users.values()) {
                user.update(this.map, this.users);
            }

            this.render();
        }
    }

    render() {
        const targetCameraX = -this.me.x * this.map.tileWidth,
            targetCameraY = -this.me.y * this.map.tileHeight;

        this.cameraZ = lerp(this.cameraZ, this.targetCameraZ, CAMERA_LERP * this.cameraZ);
        this.cameraX = lerp(this.cameraX, targetCameraX, CAMERA_LERP * this.cameraZ);
        this.cameraY = lerp(this.cameraY, targetCameraY, CAMERA_LERP * this.cameraZ);

        this.offsetCameraX = lerp(this.offsetCameraX, this.targetOffsetCameraX, CAMERA_LERP);
        this.offsetCameraY = lerp(this.offsetCameraY, this.targetOffsetCameraY, CAMERA_LERP);

        this.gFront.resetTransform();
        this.gFront.imageSmoothingEnabled = false;
        this.gFront.clearRect(0, 0, this.element.width, this.element.height);

        this.gFront.save();
        {
            this.gFront.translate(
                this.gridOffsetX + this.offsetCameraX,
                this.gridOffsetY + this.offsetCameraY);
            this.gFront.scale(this.cameraZ, this.cameraZ);
            this.gFront.translate(this.cameraX, this.cameraY);

            this.map.draw(this.gFront);

            for (let user of this.users.values()) {
                user.drawShadow(this.gFront, this.map);
            }

            for (let emote of this.emotes) {
                emote.drawShadow(this.gFront, this.map);
            }

            for (let user of this.users.values()) {
                user.drawAvatar(this.gFront, this.map);
            }

            this.drawCursor();

            for (let user of this.users.values()) {
                user.drawName(this.gFront, this.map, this.fontSize);
            }

            if (this.drawHearing) {
                this.me.drawHearingRange(
                    this.gFront,
                    this.map,
                    this.audioDistanceMin,
                    this.audioDistanceMax);
            }

            for (let emote of this.emotes) {
                emote.drawEmote(this.gFront, this.map);
            }

        }
        this.gFront.restore();
    }


    drawCursor() {
        const pointer = this.screenControls.primaryPointer;
        if (pointer) {
            const tile = this.getTileAt(pointer);
            this.gFront.strokeStyle = this.map.isClear(tile.x, tile.y, this.me.avatar)
                ? "green"
                : "red";
            this.gFront.strokeRect(
                tile.x * this.map.tileWidth,
                tile.y * this.map.tileHeight,
                this.map.tileWidth,
                this.map.tileHeight);
        }
    }
}

const KEY = "CallaSettings";

const DEFAULT_INPUT_BINDING = Object.freeze({
    keyButtonUp: "ArrowUp",
    keyButtonDown: "ArrowDown",
    keyButtonLeft: "ArrowLeft",
    keyButtonRight: "ArrowRight",
    keyButtonEmote: "e",
    keyButtonToggleAudio: "a",
    keyButtonZoomOut: "[",
    keyButtonZoomIn: "]",

    gpButtonEmote: 0,
    gpButtonToggleAudio: 1,
    gpButtonZoomIn: 6,
    gpButtonZoomOut: 7,
    gpButtonUp: 12,
    gpButtonDown: 13,
    gpButtonLeft: 14,
    gpButtonRight: 15
});

/** @type {WeakMap<Settings, SettingsPrivate>} */
const selfs$4 = new WeakMap();

class SettingsPrivate {
    constructor() {
        this.drawHearing = false;
        this.audioDistanceMin = 1;
        this.audioDistanceMax = 10;
        this.audioRolloff = 1;
        this.fontSize = 12;
        this.transitionSpeed = 1;
        this.zoom = 1.5;
        this.roomName = "calla";
        this.userName = "";
        this.email = "";
        this.avatarEmoji = null;

        /** @type {string} */
        this.avatarURL = null;
        this.gamepadIndex = 0;

        /** @type {string} */
        this.preferredAudioOutputID = null;

        /** @type {string} */
        this.preferredAudioInputID = null;

        /** @type {string} */
        this.preferredVideoInputID = null;

        this.inputBinding = DEFAULT_INPUT_BINDING;

        const selfStr = localStorage.getItem(KEY);
        if (selfStr) {
            Object.assign(
                this,
                JSON.parse(selfStr));
        }

        for (var key in DEFAULT_INPUT_BINDING) {
            if (this.inputBinding[key] === undefined) {
                this.inputBinding[key] = DEFAULT_INPUT_BINDING[key];
            }
        }

        Object.seal(this);
    }

    commit() {
        localStorage.setItem(KEY, JSON.stringify(this));
    }
}

class Settings {
    constructor() {
        const self = new SettingsPrivate();
        selfs$4.set(this, self);

        if (window.location.hash.length > 0) {
            self.roomName = window.location.hash.substring(1);
        }
        Object.seal(this);
    }

    get preferredAudioOutputID() {
        return selfs$4.get(this).preferredAudioOutputID;
    }

    set preferredAudioOutputID(value) {
        if (value !== this.preferredAudioOutputID) {
            const self = selfs$4.get(this);
            self.preferredAudioOutputID = value;
            self.commit();
        }
    }

    get preferredAudioInputID() {
        return selfs$4.get(this).preferredAudioInputID;
    }

    set preferredAudioInputID(value) {
        if (value !== this.preferredAudioInputID) {
            const self = selfs$4.get(this);
            self.preferredAudioInputID = value;
            self.commit();
        }
    }

    get preferredVideoInputID() {
        return selfs$4.get(this).preferredVideoInputID;
    }

    set preferredVideoInputID(value) {
        if (value !== this.preferredVideoInputID) {
            const self = selfs$4.get(this);
            self.preferredVideoInputID = value;
            self.commit();
        }
    }

    get transitionSpeed() {
        return selfs$4.get(this).transitionSpeed;
    }

    set transitionSpeed(value) {
        if (value !== this.transitionSpeed) {
            const self = selfs$4.get(this);
            self.transitionSpeed = value;
            self.commit();
        }
    }

    get drawHearing() {
        return selfs$4.get(this).drawHearing;
    }

    set drawHearing(value) {
        if (value !== this.drawHearing) {
            const self = selfs$4.get(this);
            self.drawHearing = value;
            self.commit();
        }
    }

    get audioDistanceMin() {
        return selfs$4.get(this).audioDistanceMin;
    }

    set audioDistanceMin(value) {
        if (value !== this.audioDistanceMin) {
            const self = selfs$4.get(this);
            self.audioDistanceMin = value;
            self.commit();
        }
    }

    get audioDistanceMax() {
        return selfs$4.get(this).audioDistanceMax;
    }

    set audioDistanceMax(value) {
        if (value !== this.audioDistanceMax) {
            const self = selfs$4.get(this);
            self.audioDistanceMax = value;
            self.commit();
        }
    }

    get audioRolloff() {
        return selfs$4.get(this).audioRolloff;
    }

    set audioRolloff(value) {
        if (value !== this.audioRolloff) {
            const self = selfs$4.get(this);
            self.audioRolloff = value;
            self.commit();
        }
    }

    get fontSize() {
        return selfs$4.get(this).fontSize;
    }

    set fontSize(value) {
        if (value !== this.fontSize) {
            const self = selfs$4.get(this);
            self.fontSize = value;
            self.commit();
        }
    }

    get zoom() {
        return selfs$4.get(this).zoom;
    }

    set zoom(value) {
        if (value !== this.zoom) {
            const self = selfs$4.get(this);
            self.zoom = value;
            self.commit();
        }
    }

    get userName() {
        return selfs$4.get(this).userName;
    }

    set userName(value) {
        if (value !== this.userName) {
            const self = selfs$4.get(this);
            self.userName = value;
            self.commit();
        }
    }

    get email() {
        return selfs$4.get(this).email;
    }

    set email(value) {
        if (value !== this.email) {
            const self = selfs$4.get(this);
            self.email = value;
            self.commit();
        }
    }

    get avatarEmoji() {
        return selfs$4.get(this).avatarEmoji;
    }

    set avatarEmoji(value) {
        if (value !== this.avatarEmoji) {
            const self = selfs$4.get(this);
            self.avatarEmoji = value;
            self.commit();
        }
    }

    get avatarURL() {
        return selfs$4.get(this).avatarURL;
    }

    set avatarURL(value) {
        if (value !== this.avatarURL) {
            const self = selfs$4.get(this);
            self.avatarURL = value;
            self.commit();
        }
    }

    get roomName() {
        return selfs$4.get(this).roomName;
    }

    set roomName(value) {
        if (value !== this.roomName) {
            const self = selfs$4.get(this);
            self.roomName = value;
            self.commit();
        }
    }

    get gamepadIndex() {
        return selfs$4.get(this).gamepadIndex;
    }

    set gamepadIndex(value) {
        if (value !== this.gamepadIndex) {
            const self = selfs$4.get(this);
            self.gamepadIndex = value;
            self.commit();
        }
    }

    get inputBinding() {
        return selfs$4.get(this).inputBinding;
    }

    set inputBinding(value) {
        if (value !== this.inputBinding) {
            const self = selfs$4.get(this);
            for (let key in value) {
                self.inputBinding[key] = value[key];
            }
            self.commit();
        }
    }
}

const CAMERA_ZOOM_MIN = 0.5,
    CAMERA_ZOOM_MAX = 20,
    settings = new Settings(),
    game = new Game(CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX),
    login = new LoginForm(),
    directory = new UserDirectoryForm(),
    controls = new ButtonLayer(game.element, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX),
    devices = new DevicesDialog(),
    options = new OptionsForm(),
    instructions = new FormDialog("instructions"),
    emoji = new EmojiForm(),
    client = new CallaClient(JITSI_HOST, JVB_HOST, JVB_MUC),
    timer = new RequestAnimationFrameTimer(),
    disabler$4 = disabled(true),
    enabler$4 = disabled(false);

let waitingForEmoji = false;

Object.assign(window, {
    settings,
    client,
    game,
    login,
    directory,
    controls,
    devices,
    options,
    emoji,
    instructions
});

async function postObj(path, obj) {
    const request = fetch(path, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(obj)
    });

    const response = await request;
    if (response.ok) {
        console.log("Thanks!");
    }

    return response;
}

async function recordJoin(Name, Email, Room) {
    await postObj("/Contacts", { Name, Email, Room });
}

async function recordRoom(roomName) {
    const response = await postObj("/Game/Rooms", roomName);
    const shortName = await response.text();
    return shortName;
}


/**
 * @callback showViewCallback
 * @returns {void}
 */

/**
 * @param {FormDialog} view
 * @returns {showViewCallback}
 */
const _showView = (view) =>
    () => showView(view);

function showView(view) {
    if (!waitingForEmoji) {
        hide(login);
        hide(directory);
        hide(options);
        hide(devices);
        hide(emoji);
        hide(instructions);
        show(view);
    }
}

async function withEmojiSelection(callback) {
    if (!isOpen(emoji)) {
        waitingForEmoji = true;
        disabler$4.apply(controls.optionsButton);
        disabler$4.apply(controls.instructionsButton);
        disabler$4.apply(controls.changeDevicesButton);
        hide(options);
        const e = await emoji.selectAsync();
        if (e) {
            callback(e);
        }
        enabler$4.apply(controls.optionsButton);
        enabler$4.apply(controls.instructionsButton);
        enabler$4.apply(controls.changeDevicesButton);
        waitingForEmoji = false;
    }
}

async function selectEmojiAsync() {
    await withEmojiSelection((e) => {
        game.emote(client.localUserID, e);
        controls.setEmojiButton(settings.inputBinding.keyButtonEmote, e);
    });
}

function setAudioProperties() {
    client.setAudioProperties(
        settings.audioDistanceMin = game.audioDistanceMin = options.audioDistanceMin,
        settings.audioDistanceMax = game.audioDistanceMax = options.audioDistanceMax,
        settings.audioRolloff = options.audioRolloff,
        settings.transitionSpeed);
}

function refreshGamepads() {
    options.gamepads = navigator.getGamepads();
    options.gamepadIndex = game.gamepadIndex;
}

function refreshUser(userID) {
    game.withUser("list user in directory", userID, (user) => directory.set(user));
}

addEventListeners(window, {
    gamepadconnected: refreshGamepads,
    gamepaddisconnected: refreshGamepads,

    resize: () => {
        game.resize();
    }
});

addEventListeners(controls, {
    toggleOptions: _showView(options),
    toggleInstructions: _showView(instructions),
    toggleUserDirectory: _showView(directory),
    changeDevices: _showView(devices),

    tweet: () => {
        const message = encodeURIComponent(`Join my #TeleParty ${document.location.href}`),
            url = new URL("https://twitter.com/intent/tweet?text=" + message);
        window.open(url);
    },

    leave: async () => {
        directory.clear();
        await client.leaveAsync();
    },

    selectEmoji: selectEmojiAsync,

    emote: () => {
        game.emote(client.localUserID, game.currentEmoji);
    },

    toggleAudio: async () => {
        await client.toggleAudioMutedAsync();
    },

    toggleVideo: async () => {
        await client.toggleVideoMutedAsync();
    },

    zoomChanged: () => {
        settings.zoom = game.zoom = controls.zoom;
    }
});

addEventListeners(login, {
    login: async () => {
        await client.audio.createClip("join", false, false, true, null, "audio/door-open.ogg", "audio/door-open.mp3", "audio/door-open.wav");
        await client.audio.createClip("leave", false, false, true, null, "audio/door-close.ogg", "audio/door-close.mp3", "audio/door-close.wav");
        setAudioProperties();

        let roomName = login.roomName;
        if (!login.roomSelectMode) {
            roomName = await recordRoom(roomName);
        }

        await recordJoin(
            settings.userName = login.userName,
            settings.email = login.email,
            settings.roomName = roomName);

        const title = `Calla - chatting in ${roomName}`;
        const path = `${window.location.pathname}#${roomName}`;
        window.history.replaceState({}, title, path);

        await directory.startAsync(roomName, login.userName);
        await client.join(roomName, login.userName);
    }
});

addEventListeners(options, {
    audioPropertiesChanged: setAudioProperties,

    selectAvatar: async () => {
        await withEmojiSelection((e) => {
            settings.avatarEmoji
                = client.avatarEmoji
                = game.me.avatarEmoji
                = e;
            refreshUser(client.localUserID);
        });
    },

    avatarURLChanged: () => {
        settings.avatarURL
            = client.avatarURL
            = game.me.avatarImage
            = options.avatarURL;
        refreshUser(client.localUserID);
    },

    toggleDrawHearing: () => {
        settings.drawHearing
            = game.drawHearing
            = options.drawHearing;
    },

    fontSizeChanged: () => {
        settings.fontSize
            = game.fontSize
            = options.fontSize;
    },

    gamepadChanged: () => {
        settings.gamepadIndex
            = game.gamepadIndex
            = options.gamepadIndex;
    },

    inputBindingChanged: () => {
        settings.inputBinding
            = game.inputBinding
            = options.inputBinding;
    },

    toggleVideo: async () => {
        await client.toggleVideoMutedAsync();
    }
});

addEventListeners(devices, {

    audioInputChanged: async () => {
        const device = devices.currentAudioInputDevice;
        await client.setAudioInputDeviceAsync(device);
        settings.preferredAudioInputID = client.preferredAudioInputID;
    },

    audioOutputChanged: async () => {
        const device = devices.currentAudioOutputDevice;
        await client.setAudioOutputDeviceAsync(device);
        settings.preferredAudioOutputID = client.preferredAudioOutputID;
    },

    videoInputChanged: async () => {
        const device = devices.currentVideoInputDevice;
        await client.setVideoInputDeviceAsync(device);
        settings.preferredVideoInputID = client.preferredVideoInputID;
    }
});

addEventListeners(game, {
    emojiNeeded: selectEmojiAsync,

    emote: (evt) => {
        client.emote(evt.emoji);
    },

    userJoined: (evt) => {
        refreshUser(evt.user.id);
    },

    toggleAudio: async () => {
        await client.toggleAudioMutedAsync();
        settings.preferredAudioInputID = client.preferredAudioInputID;
    },

    toggleVideo: async () => {
        await client.toggleVideoMutedAsync();
        settings.preferredVideoInputID = client.preferredVideoInputID;
    },

    gameStarted: () => {
        game.resize();
        hide(login);
        show(controls);

        options.user = game.me;

        controls.enabled = true;

        settings.avatarEmoji
            = client.avatarEmoji
            = game.me.avatarEmoji
            = settings.avatarEmoji
            || allPeople.random();

        refreshUser(client.localUserID);
    },

    userMoved: (evt) => {
        client.setLocalPosition(evt.x, 0, evt.y);
    },

    gameEnded: () => {
        login.connected = false;
        showView(login);
    },

    zoomChanged: () => {
        settings.zoom = controls.zoom = game.zoom;
    }
});

addEventListeners(directory, {
    warpTo: (evt) => {
        game.visit(evt.id);
    },
    chatFocusChanged: () => {
        game.keyboardEnabled = !directory.chatFocused;
    }
});

addEventListeners(client, {

    videoConferenceJoined: async (evt) => {
        login.connected = true;

        await game.startAsync(evt.id, evt.displayName, evt.pose, evt.avatarURL, evt.roomName);

        client.avatarURL
            = game.me.avatarImage
            = options.avatarURL
            = settings.avatarURL;

        devices.audioInputDevices = await client.getAudioInputDevicesAsync();
        devices.audioOutputDevices = await client.getAudioOutputDevicesAsync();
        devices.videoInputDevices = await client.getVideoInputDevicesAsync();

        settings.preferredAudioInputID = client.preferredAudioInputID;
        settings.preferredAudioOutputID = client.preferredAudioOutputID;
        settings.preferredVideoInputID = client.preferredVideoInputID;

        devices.currentAudioInputDevice = await client.getCurrentAudioInputDeviceAsync();
        devices.currentAudioOutputDevice = await client.getCurrentAudioOutputDeviceAsync();
        devices.currentVideoInputDevice = await client.getCurrentVideoInputDeviceAsync();

        const audioMuted = client.isAudioMuted;
        game.muteUserAudio(client.localUserID, audioMuted);
        controls.audioEnabled = !audioMuted;

        const videoMuted = client.isVideoMuted;
        game.muteUserVideo(client.localUserID, videoMuted);
        controls.videoEnabled = !videoMuted;
    },

    videoConferenceLeft: () => {
        game.end();
    },

    participantJoined: (evt) => {
        client.audio.playClip("join", 0.5);
        game.addUser(evt.id, evt.displayName, evt.pose);
    },

    participantLeft: (evt) => {
        client.audio.playClip("leave", 0.5);
        game.removeUser(evt.id);
        directory.delete(evt.id);
    },

    audioChanged: (evt) => {
        refreshUser(evt.id);
    },

    videoChanged: (evt) => {
        game.setAvatarVideo(evt.id, evt.stream);
        refreshUser(evt.id);
    },

    avatarChanged: (evt) => {
        game.setAvatarURL(evt.id, evt.url);
        refreshUser(evt.id);
    },

    displayNameChange: (evt) => {
        game.changeUserName(evt.id, evt.displayName);
        refreshUser(evt.id);
    },

    audioMuteStatusChanged: async (evt) => {
        game.muteUserAudio(evt.id, evt.muted);
    },

    localAudioMuteStatusChanged: async (evt) => {
        controls.audioEnabled = !evt.muted;
        devices.currentAudioInputDevice = await client.getCurrentAudioInputDeviceAsync();
        settings.preferredAudioInputID = client.preferredAudioInputID;
    },

    videoMuteStatusChanged: async (evt) => {
        game.muteUserVideo(evt.id, evt.muted);
        settings.preferredVideoInputID = client.preferredVideoInputID;
    },

    localVideoMuteStatusChanged: async (evt) => {
        controls.videoEnabled = !evt.muted;
        if (evt.muted) {
            options.setAvatarVideo(null);
        }
        else {
            options.setAvatarVideo(game.me.avatarVideo.element);
        }
        devices.currentVideoInputDevice = await client.getCurrentVideoInputDeviceAsync();
    },

    userInitRequest: (evt) => {
        client.userInitResponse(evt.id, game.me.serialize());
    },

    userInitResponse: (evt) => {
        game.initializeUser(evt.id, evt);
        refreshUser(evt.id);
    },

    emote: (evt) => {
        game.emote(evt.id, evt);
    },

    setAvatarEmoji: (evt) => {
        game.setAvatarEmoji(evt.id, evt);
        refreshUser(evt.id);
    },

    audioActivity: (evt) => {
        game.updateAudioActivity(evt.id, evt.isActive);
    }
});

addEventListeners(timer, {
    tick: (evt) => {
        client.update();
        options.update();
        directory.update();
        game.update(evt.dt);
    }
});

options.drawHearing = game.drawHearing = settings.drawHearing;
options.audioDistanceMin = game.audioDistanceMin = settings.audioDistanceMin;
options.audioDistanceMax = game.audioDistanceMax = settings.audioDistanceMax;
options.audioRolloff = settings.audioRolloff;
options.fontSize = game.fontSize = settings.fontSize;
options.gamepads = navigator.getGamepads();
options.gamepadIndex = game.gamepadIndex = settings.gamepadIndex;
options.inputBinding = game.inputBinding = settings.inputBinding;

controls.zoom = game.zoom = settings.zoom;
game.cameraZ = game.targetCameraZ;
game.transitionSpeed = settings.transitionSpeed = 0.5;
login.userName = settings.userName;
login.roomName = settings.roomName;
login.email = settings.email;

controls.enabled = false;
showView(login);

login.ready = true;
timer.start();

loadFont(makeFont({
    fontFamily: "Noto Color Emoji",
    fontSize: 100
}));

} catch(exp) {
    TraceKit.report(exp);
}
//# sourceMappingURL=game.js.map
