//! annyang
//! version : 2.6.0
//! author  : Tal Ater @TalAter
//! license : MIT
//! https://www.TalAter.com/annyang/
(function (root, factory) {
    'use strict';
    if (typeof define === 'function' && define.amd) { // AMD + global
      define([], function () {
        return (root.annyang = factory(root));
      });
    } else if (typeof module === 'object' && module.exports) { // CommonJS
      module.exports = factory(root);
    } else { // Browser globals
      root.annyang = factory(root);
    }
  }(typeof window !== 'undefined' ? window : this, function (root, undefined) {
    'use strict';
  
  
    var annyang;
  
    // Get the SpeechRecognition object, while handling browser prefixes
    var SpeechRecognition = root.SpeechRecognition ||
                            root.webkitSpeechRecognition ||
                            root.mozSpeechRecognition ||
                            root.msSpeechRecognition ||
                            root.oSpeechRecognition;
  
    // Check browser support
    // This is done as early as possible, to make it as fast as possible for unsupported browsers
    if (!SpeechRecognition) {
      return null;
    }
  
    var commandsList = [];
    var recognition;
    var callbacks = { start: [], error: [], end: [], soundstart: [], result: [], resultMatch: [], resultNoMatch: [], errorNetwork: [], errorPermissionBlocked: [], errorPermissionDenied: [] };
    var autoRestart;
    var lastStartedAt = 0;
    var autoRestartCount = 0;
    var debugState = false;
    var debugStyle = 'font-weight: bold; color: #00f;';
    var pauseListening = false;
    var isListening = false;
  
    // The command matching code is a modified version of Backbone.Router by Jeremy Ashkenas, under the MIT license.
    var optionalParam = /\s*\((.*?)\)\s*/g;
    var optionalRegex = /(\(\?:[^)]+\))\?/g;
    var namedParam    = /(\(\?)?:\w+/g;
    var splatParam    = /\*\w+/g;
    var escapeRegExp  = /[\-{}\[\]+?.,\\\^$|#]/g;
    var commandToRegExp = function(command) {
      command = command.replace(escapeRegExp, '\\$&')
                    .replace(optionalParam, '(?:$1)?')
                    .replace(namedParam, function(match, optional) {
                      return optional ? match : '([^\\s]+)';
                    })
                    .replace(splatParam, '(.*?)')
                    .replace(optionalRegex, '\\s*$1?\\s*');
      return new RegExp('^' + command + '$', 'i');
    };
  
    // This method receives an array of callbacks to iterate over, and invokes each of them
    var invokeCallbacks = function(callbacks, ...args) {
      callbacks.forEach(function(callback) {
        callback.callback.apply(callback.context, args);
      });
    };
  
    var isInitialized = function() {
      return recognition !== undefined;
    };
  
    // method for logging in developer console when debug mode is on
    var logMessage = function(text, extraParameters) {
      if (text.indexOf('%c') === -1 && !extraParameters) {
        console.log(text);
      } else {
        console.log(text, extraParameters || debugStyle);
      }
    };
  
    var initIfNeeded = function() {
      if (!isInitialized()) {
        annyang.init({}, false);
      }
    };
  
    var registerCommand = function(command, callback, originalPhrase) {
      commandsList.push({ command, callback, originalPhrase });
      if (debugState) {
        logMessage('Command successfully loaded: %c'+originalPhrase, debugStyle);
      }
    };
  
    var parseResults = function(results) {
      invokeCallbacks(callbacks.result, results);
      var commandText;
      // go over each of the 5 results and alternative results received (we've set maxAlternatives to 5 above)
      for (let i = 0; i<results.length; i++) {
        // the text recognized
        commandText = results[i].trim();
        if (debugState) {
          logMessage('Speech recognized: %c'+commandText, debugStyle);
        }
  
        // try and match recognized text to one of the commands on the list
        for (let j = 0, l = commandsList.length; j < l; j++) {
          var currentCommand = commandsList[j];
          var result = currentCommand.command.exec(commandText);
          if (result) {
            var parameters = result.slice(1);
            if (debugState) {
              logMessage('command matched: %c'+currentCommand.originalPhrase, debugStyle);
              if (parameters.length) {
                logMessage('with parameters', parameters);
              }
            }
            // execute the matched command
            currentCommand.callback.apply(this, parameters);
            invokeCallbacks(callbacks.resultMatch, commandText, currentCommand.originalPhrase, results);
            return;
          }
        }
      }
      invokeCallbacks(callbacks.resultNoMatch, results);
    };
  
    annyang = {
  
      init: function(commands, resetCommands = true) {
        // Abort previous instances of recognition already running
        if (recognition && recognition.abort) {
          recognition.abort();
        }
  
        // initiate SpeechRecognition
        recognition = new SpeechRecognition();
  
        // Set the max number of alternative transcripts to try and match with a command
        recognition.maxAlternatives = 5;
  
        // In HTTPS, turn off continuous mode for faster results.
        // In HTTP,  turn on  continuous mode for much slower results, but no repeating security notices
        recognition.continuous = root.location.protocol === 'http:';
  
        // Sets the language to the default 'en-US'. This can be changed with annyang.setLanguage()
        recognition.lang = 'ko';
  
        recognition.onstart = function() {
          isListening = true;
          invokeCallbacks(callbacks.start);
        };
  
        recognition.onsoundstart = function() {
          invokeCallbacks(callbacks.soundstart);
        };
  
        recognition.onerror = function(event) {
          invokeCallbacks(callbacks.error, event);
          switch (event.error) {
          case 'network':
            invokeCallbacks(callbacks.errorNetwork, event);
            break;
          case 'not-allowed':
          case 'service-not-allowed':
            // if permission to use the mic is denied, turn off auto-restart
            autoRestart = false;
            // determine if permission was denied by user or automatically.
            if (new Date().getTime()-lastStartedAt < 200) {
              invokeCallbacks(callbacks.errorPermissionBlocked, event);
            } else {
              invokeCallbacks(callbacks.errorPermissionDenied, event);
            }
            break;
          }
        };
  
        recognition.onend = function() {
          isListening = false;
          invokeCallbacks(callbacks.end);
          // annyang will auto restart if it is closed automatically and not by user action.
          if (autoRestart) {
            // play nicely with the browser, and never restart annyang automatically more than once per second
            var timeSinceLastStart = new Date().getTime()-lastStartedAt;
            autoRestartCount += 1;
            if (autoRestartCount % 10 === 0) {
              if (debugState) {
                logMessage('Speech Recognition is repeatedly stopping and starting. See http://is.gd/annyang_restarts for tips.');
              }
            }
            if (timeSinceLastStart < 1000) {
              setTimeout(function() {
                annyang.start({ paused: pauseListening });
              }, 1000-timeSinceLastStart);
            } else {
              annyang.start({ paused: pauseListening });
            }
          }
        };
  
        recognition.onresult = function(event) {
          if(pauseListening) {
            if (debugState) {
              logMessage('Speech heard, but annyang is paused');
            }
            return false;
          }
  
          // Map the results to an array
          var SpeechRecognitionResult = event.results[event.resultIndex];
          var results = [];
          for (let k = 0; k<SpeechRecognitionResult.length; k++) {
            results[k] = SpeechRecognitionResult[k].transcript;
          }
  
          parseResults(results);
        };
  
        // build commands list
        if (resetCommands) {
          commandsList = [];
        }
        if (commands.length) {
          this.addCommands(commands);
        }
      },
  
      start: function(options) {
        initIfNeeded();
        options = options || {};
        if (options.paused !== undefined) {
          pauseListening = !!options.paused;
        } else {
          pauseListening = false;
        }
        if (options.autoRestart !== undefined) {
          autoRestart = !!options.autoRestart;
        } else {
          autoRestart = true;
        }
        if (options.continuous !== undefined) {
          recognition.continuous = !!options.continuous;
        }
  
        lastStartedAt = new Date().getTime();
        try {
          recognition.start();
        } catch(e) {
          if (debugState) {
            logMessage(e.message);
          }
        }
      },
//   abort
    
      abort: function() {
        autoRestart = false;
        autoRestartCount = 0;
        if (isInitialized()) {
          recognition.abort();
        }
      },
  
      pause: function() {
        pauseListening = true;
      },
  
      resume: function() {
        annyang.start();
      },
  
      debug: function(newState = true) {
        debugState = !!newState;
      },
  
      setLanguage: function(language) {
        initIfNeeded();
        recognition.lang = language;
      },
  
      addCommands: function(commands) {
        var cb;
  
        initIfNeeded();
  
        for (let phrase in commands) {
          if (commands.hasOwnProperty(phrase)) {
            cb = root[commands[phrase]] || commands[phrase];
            if (typeof cb === 'function') {
              // convert command to regex then register the command
              registerCommand(commandToRegExp(phrase), cb, phrase);
            } else if (typeof cb === 'object' && cb.regexp instanceof RegExp) {
              // register the command
              registerCommand(new RegExp(cb.regexp.source, 'i'), cb.callback, phrase);
            } else {
              if (debugState) {
                logMessage('Can not register command: %c'+phrase, debugStyle);
              }
              continue;
            }
          }
        }
      },
  
      removeCommands: function(commandsToRemove) {
        if (commandsToRemove === undefined) {
          commandsList = [];
        } else {
          commandsToRemove = Array.isArray(commandsToRemove) ? commandsToRemove : [commandsToRemove];
          commandsList = commandsList.filter(command => {
            for (let i = 0; i<commandsToRemove.length; i++) {
              if (commandsToRemove[i] === command.originalPhrase) {
                return false;
              }
            }
            return true;
          });
        }
      },
  
      addCallback: function(type, callback, context) {
        var cb = root[callback] || callback;
        if (typeof cb === 'function' && callbacks[type] !== undefined) {
          callbacks[type].push({callback: cb, context: context || this});
        }
      },
  
      removeCallback: function(type, callback) {
        var compareWithCallbackParameter = function(cb) {
          return cb.callback !== callback;
        };
        // Go over each callback type in callbacks store object
        for (let callbackType in callbacks) {
          if (callbacks.hasOwnProperty(callbackType)) {
            // if this is the type user asked to delete, or he asked to delete all, go ahead.
            if (type === undefined || type === callbackType) {
              // If user asked to delete all callbacks in this type or all types
              if (callback === undefined) {
                callbacks[callbackType] = [];
              } else {
                // Remove all matching callbacks
                callbacks[callbackType] = callbacks[callbackType].filter(compareWithCallbackParameter);
              }
            }
          }
        }
      },
  
      isListening: function() {
        return isListening && !pauseListening;
      },
  
      getSpeechRecognizer: function() {
        return recognition;
      },
  
      trigger: function(sentences) {
        if(!annyang.isListening()) {
          if (debugState) {
            if (!isListening) {
              logMessage('Cannot trigger while annyang is aborted');
            } else {
              logMessage('Speech heard, but annyang is paused');
            }
          }
          return;
        }
  
        if (!Array.isArray(sentences)) {
          sentences = [sentences];
        }
  
        parseResults(sentences);
      }
    };
  
    return annyang;
  
  }));