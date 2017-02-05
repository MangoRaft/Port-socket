//#!/usr/bin/env node

var program = require('commander');
var Port = require('port-docker');
var path = require('path');
var fs = require('fs');
var os = require('os');
var async = require('async');

var DStats = require('dstats');
var Docker = require('dockerode');
var io = require('socket.io-client');
var debug = require('debug')('Port-api');
var ip = require('ip');

program.version(require('../package.json').version);

program.description('View logs in teal-time.');

program.option('-u, --url [HOST]', 'HOST (default: http://127.0.0.1:8000)', 'http://127.0.0.1:8000');
program.option('-z, --zone [REGION]', 'Zone located in (far1)', 'far1');
program.option('-t, --token [TOKEN]', 'Token auth');
program.option('-e, --environment [ENVIROMENT]', 'environment to use (services)', 'services');
program.option('-n, --name [NAME]', 'name to use (port)', 'test');
program.option('-i, --id [ID]', 'id to use (port)', 'test');
program.option('-m, --multi-tenant [MULTITENANT]', 'multiTenant (default: true)', true);
program.option('-s, --stats [STATS]', false);
program.option('-a, --address [ADDRESS]', ip.address());
program.option('-b, --stats-host [HOST]', '127.0.0.1');
program.option('-c, --stats-port [PORT]', 8125);
program.parse(process.argv);
program.address = program.address || ip.address();
var wait = [];

var port = new Port({
	name : program.name,
	address : program.address,
	environment : program.environment,
	maxMemory : os.totalmem() / Math.pow(1024, 2),
	multiTenant : program.multiTenant,
	docker : {
		socket : '/var/run/docker.sock',
		//host : '127.0.0.1',
		//port : 4243,
	}
});
port.on('error', function(err) {
	console.log(err);
});

function onError(err) {
	console.log(Object.keys(err))
	var error = {};
	Object.keys(err).forEach(function(key) {
		error[key] = err[key];
	});
	return error;
}

port.once('run', function() {

	port.docker.info(function(err, info) {
		if (err) {
			throw err;
		}

		var socket = io.connect(program.url, {
			query : 'token=' + program.token + '&id=' + program.id
		});

		socket.on('connect', function() {
			console.log('authenticated');
			var _wait = wait;
			wati = [];
			_wait.forEach(function(item) {
				socket.emit('wait', item[0], item[1]);
			});

			var info = {
				address : program.address,
				name : program.name,
				id : program.id,
				hostname : os.hostname(),
				type : os.type(),
				platform : os.platform(),
				arch : os.arch(),
				release : os.release(),
				totalmem : os.totalmem(),
				freemem : os.freemem(),
				cpus : os.cpus(),
				environment : program.environment,
				zone : program.zone,
				name : program.name,
				memory : {
					used : port.usagedMemory
				},
				cores : {
					count : port.cores,
					used : port.coresUsed
				},
				'multiTenant' : program.multiTenant
			};

			console.log(info);
			socket.emit('init', info);
		}).on('error', function(error) {
			console.log('error', error);
		});

		socket.on('version', function(cb) {
			debug('Container.version');

			port.docker.version(function(err, version) {
				if (err) {
					return cb(onError(err));
				}
				cb(null, version);
			});
		});

		socket.on('info', function(cb) {
			debug('Container.info');

			port.docker.info(function(err, info) {
				if (err) {
					return cb(onError(err));
				}
				cb(null, info);
			});
		});

		socket.on('resources', function(cb) {
			debug('Container.resources');
			var ids = Object.keys(port.containers);
			cb(null, {
				memory : {
					used : port.usagedMemory
				},
				cores : {
					count : port.cores,
					used : port.coresUsed
				},
				containers : {
					count : ids.length,
					ids : ids
				}
			});

		});

		socket.on('get', function(id, cb) {
			debug('Container.get');

			if (!port.containers[id]) {
				return cb({
					error : 'No container found'
				});
			}
			var container = port.containers[id];

			cb(null, {
				container : container.info
			});
		});

		socket.on('all', function(cb) {
			debug('Container.all');

			var containers = {};

			async.parallelLimit(Object.keys(port.containers).map(function(id) {
				return function(next) {
					next(null, port.containers[id].info);
				};
			}), 5, function(errors, results) {
				cb(null, {
					errors : errors,
					containers : results
				});
			});
		});
		socket.on('start', function(data, cb) {
			debug('Container.post');

			if (program.stats) {
				data.stats = true;
			}
			port.start(data, function(err, container) {
				if (err) {
					return cb(onError(err));
				}
				cb(null, container.info);
			});
		});
		socket.on('destroy', function(data, cb) {
			debug('Container.distroy');
			port.destroy(function(result) {
				cb(null, {
					result : result
				});
			});
		});
		socket.on('stop', function(id, cb) {
			debug('Container.del');

			if (!port.containers[id]) {

				var err = new Error('No container found');
				err.code = 'S1';

				return cb(onError(err));
			}
			var container = port.containers[id];

			port.stop(id, function(err) {
				if (err) {
					return cb(onError(err));
				}
				cb();
			});
		});

		port.on('wait', function(container, result) {

			if (socket.connected)
				socket.emit('wait', container.info, result.StatusCode);
			else {
				wait.push([container.info, result.StatusCode]);
			}
		});

		port.on('state', function(state, container) {
			socket.emit('state', state, container.info);
		});
		if (program.stats) {
			port.on('stats', function sendStats(stats, container) {
				if (!container._stats) {
					container._stats = new DStats({
						host : program.statsHost,
						port : program.statsPort,
						key : container.options.metricSession + '.' + container.options.name + '.' + container.options.index
					});
				}
				container._stats.stats(stats);
			});
		}
		process.on('SIGINT', function() {
			socket.emit('exit');

			port.destroy(function(data) {
				setTimeout(function() {
					process.exit(1);
				}, 1000);
			});
		});

	});
});
port.run();
