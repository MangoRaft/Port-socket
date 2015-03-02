//#!/usr/bin/env node

var program = require('commander');
var Port = require('../../Port');
var path = require('path');
var fs = require('fs');
var os = require('os');
var async = require('async');

var Docker = require('dockerode');
var io = require('socket.io-client');
var debug = require('debug')('Port-api');

program.version(require('../package.json').version);

program.description('View logs in teal-time.');

program.option('-u, --url [HOST]', 'HOST (default: http://127.0.0.1:8000)', 'http://127.0.0.1:8000');
program.option('-r, --region [REGION]', 'Region located in (us)');
program.option('-t, --token [TOKEN]', 'Token auth');
program.option('-e, --environment [ENVIROMENT]', 'environment to use (services)');
program.option('-n, --name [NAME]', 'name to use (port)');
program.option('-m, --multi-tenant [MULTITENANT]', 'multiTenant (default: true)', true);
program.option('-s, --token [TOKEN]', 'token');

program.parse(process.argv);

var wait = [];

var socket = io.connect(program.url, {
	query : 'token=' + program.token
});
socket.on('connect', function() {
	console.log('authenticated');
	var _wait = wait;
	wati = [];
	_wait.forEach(function(item) {
		socket.emit('wait', item[0], item[1]);
	});
}).on('connect_error', function() {
	console.log('connect_error');
}).on('connect_timeout', function() {
	console.log('connect_timeout');
}).on('reconnect', function() {
	console.log('reconnect');
}).on('reconnect_attempt', function() {
	console.log('reconnect_attempt');
}).on('reconnecting', function() {
	console.log('reconnecting');
}).on('reconnect_error', function() {
	console.log('reconnect_error');
}).on('reconnect_failed', function() {
	console.log('reconnect_failed');
}).on('disconnect', function() {
	console.log('disconnected');
}).on('error', function(error) {
	throw error;
});

var port = new Port({
	name : program.name,
	environment : program.environment,
	maxMemory : 2222222,
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

port.once('run', function() {

	socket.emit('init', {
		hostname : os.hostname(),
		type : os.type(),
		platform : os.platform(),
		arch : os.arch(),
		release : os.release(),
		totalmem : os.totalmem(),
		freemem : os.freemem(),
		cpus : os.cpus(),
		environment : program.environment,
		region : program.region,
		name : program.name,
		'multi-tenant' : program.multitenant,
	});
});

socket.on('version', function(cb) {
	debug('Container.version');

	port.docker.version(function(err, version) {
		if (err) {
			return cb({
				stack : err.stack,
				arguments : err.arguments,
				type : err.type,
				message : err.message,
				status : err.status
			});
		}
		cb(null, version);
	});
});

socket.on('info', function(cb) {
	debug('Container.info');

	port.docker.info(function(err, info) {
		if (err) {
			return cb({
				stack : err.stack,
				arguments : err.arguments,
				type : err.type,
				message : err.message,
				status : err.status
			});
		}
		cb(null, info);
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
	port.start(data, function(err, container) {
		if (err) {
			console.log(err)
			return cb({
				stack : err.stack,
				arguments : err.arguments,
				type : err.type,
				message : err.message,
				status : err.status
			});
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
		return cb({
			error : 'No container found'
		});
	}
	var container = port.containers[id];

	port.stop(id, function(err) {
		if (err) {
			return cb({
				stack : err.stack,
				arguments : err.arguments,
				type : err.type,
				message : err.message,
				status : err.status
			});
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

process.on('SIGINT', function() {

	port.destroy(function(data) {
		socket.on('exit');
		process.nextTick(function() {
			process.exit(1);
		});
	});
});

port.run();
