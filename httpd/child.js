// httpd/child.js

HttpChild = (function() {
    var requestsHandled;

	function notFound() {
        global.notFound_action && global.notFound_action();
		res.reset();
		res.status = 404;
		res.write('<h1>Not Found</h1>');
		res.stop();
	}

	var jst_cache = {};
	function getCachedJst(fn) {
		var jst = jst_cache[fn];
		if (!jst || fs.stat(fn).mtime < jst.mtime) {
			var source = fs.readFile(fn);
			jst = {
				mtime: fs.stat(fn).mtime,
				parsed: Jst.parse(source)
			};
			jst_cache[fn] = jst;
		}
		return jst.parsed;
	}

	function sendFile(fn) {
		res.sendFile(fn);
	}

	function includeJst(fn) {
		var jst = getCachedJst(Config.documentRoot + fn);
		return Jst.includeParsed(jst, {
			include: includeJst
		});
	}

	function runJst(fn) {
		var jst = getCachedJst(fn);
		var out = Jst.executeParsed(jst, {
			include: includeJst
		});
		res.contentLength = out.length;
		res.write(out);
		res.stop();
	}

	var coffee_cache = {};
	function getCachedCoffee(fn) {
		var coffee = coffee_cache[fn];
		var mtime = fs.stat(fn).mtime;
		if (!coffee || mtime > coffee.mtime) {
			if (coffee) {
				v8.freeScript(coffee.script);
			}
			
			var source = fs.readFile(fn);
			var compiled = CoffeeScript.compile(source);
			var script = v8.compileScript(compiled);
			coffee = {
				mtime: mtime,
				script: script
			};
			coffee_cache[fn] = coffee;
		}
		return coffee.script;
	}
	
	function runCoffee(fn) {
		var coffee = getCachedCoffee(fn);
		var out = v8.runScript(coffee);
//		res.contentLength = out.length;
//		res.write(out);
		res.stop();
	}
	
	function runMarkdown(fn) {
		var content = fs.readFile(fn);
		var converter = new Showdown.converter();
		var html = converter.makeHtml(content);
		res.write(html);
		res.stop();
	}
	
	var contentTypes = {
		coffee:	{ contentType: 'text/html',		  handler: runCoffee },
		jst:	{ contentType: 'text/html',       handler: runJst },
		md:		{ contentType: 'text/html',       handler: runMarkdown },
		ogg:	{ contentType: 'audio/ogg',       handler: sendFile },
		mp3:	{ contentType: 'audio/mpeg3',     handler: sendFile },
		png:	{ contentType: 'image/png',       handler: sendFile },
		ico:	{ contentType: 'image/ico',       handler: sendFile },
		gif:	{ contentType: 'image/gif',       handler: sendFile },
		jpg:	{ contentType: 'image/jpeg',      handler: sendFile },
		jpeg:	{ contentType: 'image/jpeg',      handler: sendFile },
		html:	{ contentType: 'text/html',       handler: sendFile },
		js:		{ contentType: 'text/javascript', handler: sendFile },
		css:	{ contentType: 'text/css',        handler: sendFile },
		xml:	{ contentType: 'text/xml',        handler: sendFile }
	};

	function handleRequest() {
		var parts = req.uri.substr(1).split('/');
        if (parts[0].length == 0) {
            parts[0] = 'main';
        }
        var action = parts[0] + '_action';
        if (global[action]) {
            global[action]();
//            res.stop();
        }

		var fnPath = Config.documentRoot + req.uri;
		var fn = fs.realpath(fnPath);
		if (!fn) {
			notFound();
		}
		if (fs.isDir(fn)) {
			if (!req.uri.endsWith('/')) {
				log('redirect ' + req.uri + ' ' + fn + ' ' + fn.substr(fn.length-1, 1));
				res.redirect(req.uri + '/');
			}
			var found = '';
			forEach(Config.directoryIndex, function(index) {
				var f = fn;
				f += '/';
				f += index;
				if (fs.exists(f)) {
					found = f;
				}
			})
			if (found) {
				fn = found;
			}
			else {
				fn += '/index.jst';
			}
		}
		if (!fs.isFile(fn)) {
			// could do a directory listing here
			notFound();
		}

		res.status = 200;
        req.path = fn;
		parts = fn.split('.');
		if (parts.length > 1) {
			var extension = parts.pop();
			var handler = contentTypes[extension.toLowerCase()];
			if (handler) {
				res.contentType = handler.contentType;
				handler.handler(fn);
			}
		}
		var stat = fs.stat(fn);
		if (!stat) {
			log('error: ' + fs.error());
		}
		res.contentType = 'text/plain';
		res.sendHeaders();
		net.sendFile(res.sock, fn, 0, stat.size);
	}

    // semaphore for locking around accept()
    var USE_FLOCK = true;
    var lock = USE_FLOCK ? function(lockfd) { fs.flock(lockfd, fs.LOCK_EX) } : function(lockfd) { fs.lockf(lockfd, fs.F_LOCK); }
    var unlock = USE_FLOCK ? function(lockfd) { fs.flock(lockfd, fs.LOCK_UN) } : function(lockfd) { fs.lockf(lockfd, fs.F_ULOCK); }

	return {
		requestHandler: null,
		run: function(serverSocket, pid) {
			if (Config.mysql) {
				SQL = new MySQL();
				SQL.connect();
			}
			var REQUESTS_PER_CHILD = Config.requestsPerChild;
			var requestHandler = HttpChild.requestHandler;
			requestsHandled = 0;
			var lockfd = fs.open(Config.lockFile, fs.O_RDONLY);
			while (requestsHandled < REQUESTS_PER_CHILD) {
                lock(lockfd);
				var sock = net.accept(serverSocket);
                unlock(lockfd);
                silk.checkIncludes();
				var keepAlive = true;
				while (keepAlive) {
					if (++requestsHandled > REQUESTS_PER_CHILD) {
						keepAlive = false;
					}
					try {
						if (!req.init(sock)) {
							break;
						}
						keepAlive = res.init(sock, keepAlive, requestsHandled);
						// execute a pure JavaScript handler, if provided.
						if (requestHandler) {
							requestHandler();
						}
						handleRequest();
					}
					catch (e) {
						if (e !== 'RES.STOP') {
							Error.exceptionHandler(e);
							break;
						}
					}
					res.flush();
					// this logfile.write() reduces # requests/sec by 5000!
					logfile.write(req.remote_addr + ' ' + req.method + ' ' + req.uri + ' completed in ' + (new Date().getTime() - req.start) + '\n');
				}
				req.close();
				net.close(sock);
				v8.gc();
			}
			fs.close(lockfd);
			res.close();
		}
	};
})();
	
