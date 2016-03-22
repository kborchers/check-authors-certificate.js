module.exports = checkAUTHORSCertificate;

var child = require('child_process');
var fs = require('fs');
var parse = require('peoplestring-parse');
var path = require('path');
var github = require('github-request');

function filterAuthors(gitAuthors, authors) {
  return gitAuthors
    .filter(function(gitAuthor) {
      return ( authors.indexOf(gitAuthor) < 0 );
    });
}

function gitCommand(options) {
  var childError = false;

  var git = child.spawn('git', options.commandArgs, options.commandOptions);

  var outputBuffers = [];
  git.stdout
    .on('data', function(buffer) {
      outputBuffers.push(buffer);
    });

  var errorBuffers = [];
  git.stderr
    .on('data', function(buffer) {
      errorBuffers.push(buffer);
    });

  git
    .on('error', function(error) {
      childError = error;
    })
    .on('close', function(exitCode) {
      if (exitCode !== 0) {
        options.callback(
          new Error(
            'Failed with exit code ' + exitCode + ':\n' +
            Buffer.concat(errorBuffers).toString()
          )
        );
      } else if (childError) {
        options.callback(childError)
      } else {
        options.nextStep(outputBuffers, options.callback);
      }
    }
  );
}

function checkAUTHORSCertificate(isPR, directory, callback) {
  listCorrectGitAuthors(isPR, directory, function(error, gitAuthors) {
    if (error) {
      callback(error);
    } else {
      listAUTHORS(directory, function(error, authors) {
        if (error) {
          callback(error);
        } else {
          var missing = [];
          if (isPR) {
            missing = filterAuthors(authors, gitAuthors)
          } else {
            missing = filterAuthors(gitAuthors, authors);
          }
          callback(null, missing);
        }
      });
    }
  });
}

function listCorrectGitAuthors(isPR, directory, callback) {
  if (isPR) {
    github.request({
      path: '/repos/' + process.env.TRAVIS_REPO_SLUG + '/pulls/' + process.env.TRAVIS_PULL_REQUEST
    }, function(error, pr) {
      gitCommand({
        commandArgs: [ 'clone', pr.head.repo.clone_url, "pr-repo"  ],
        commandOptions: { cwd: directory + '../' },
        callback: callback,
        nextStep: listGitAuthors
      });
    });
  } else {
    gitCommand({
      commandArgs: [ 'log',  '--format=%aN' ],
      commandOptions: { cwd: directory },
      callback: callback,
      nextStep: listGitAuthors
    });
  }
}

function listGitAuthors(outputBuffers, callback) {
  var gitAuthors = Buffer.concat(outputBuffers)
    .toString()
    .split('\n')
    .reduce(
      function(unique, element) {
        var empty = ( element.trim().length === 0 );
        var seen = ( unique.indexOf(element) > -1 );
        return ( ( !seen && !empty ) ?
          unique.concat(element) :
          unique
        )
      }, []);

  callback(null, gitAuthors);
}

var commentRE = /^\s*#/;

function listAUTHORS(directory, callback) {
  var authorsFile = path.join(directory, 'AUTHORS');
  fs.access(authorsFile, fs.R_OK, function(error) {
    if (error) {
      callback(new Error('Cannot read ' + authorsFile + '.'));
    } else {
      fs.readFile(authorsFile, function(error, buffer) {
        if (error) {
          callback(error);
        } else {
          var authors = buffer
           .toString()
           .split('\n')
           .filter(function(line) {
             return !commentRE.test(line);
           })
           .reduce(
             function(authors, line) {
               var parsed = parse(line);
               if (!parsed) {
                 return authors;
               } else {
                 if (( 'name' in parsed ) && ( authors.indexOf(parsed.name) < 0 )) {
                   return authors.concat(parsed.name);
                 } else {
                   return authors;
                 }
               }
             }, []);

          callback(null, authors);
        }
      });
    }
  });
}
