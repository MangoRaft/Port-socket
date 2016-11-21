//#!/usr/bin/env node

var program = require('commander');
var Port = require('../../Port');
var path = require('path');
var fs = require('fs');
var os = require('os');
var async = require('async');
var StatsD = require('node-statsd');

var Docker = require('dockerode');
var io = require('socket.io-client');
var debug = require('debug')('Port-api');

program.version(require('../package.json').version);

program.description('View logs in teal-time.');

program.option('-u, --url [HOST]', 'HOST (default: http://127.0.0.1:8000)', 'http://127.0.0.1:8000');
program.option('-r, --region [REGION]', 'Region located in (us)', 'us');
program.option('-t, --token [TOKEN]', 'Token auth');
program.option('-e, --environment [ENVIROMENT]', 'environment to use (services)', 'services');
program.option('-n, --name [NAME]', 'name to use (port)', 'test');
program.option('-m, --multi-tenant [MULTITENANT]', 'multiTenant (default: true)', true);
program.option('-s, --stats [STATS]', false);
program.option('-a, --address [ADDRESS]', '127.0.0.1');
program.option('-b, --stats-host [HOST]', '127.0.0.1');
program.option('-c, --stats-port [PORT]', 8125);

program.parse(process.argv);

var wait = [];

if (program.stats) {
	var statsD = new StatsD({
		host : program.statsHost,
		port : program.statsPort
	});
}

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
a = {
	"read" : "2015-01-08T22:57:31.547920715Z",
	"networks" : {
		"eth0" : {
			"rx_bytes" : 5338,
			"rx_dropped" : 0,
			"rx_errors" : 0,
			"rx_packets" : 36,
			"tx_bytes" : 648,
			"tx_dropped" : 0,
			"tx_errors" : 0,
			"tx_packets" : 8
		},
		"eth5" : {
			"rx_bytes" : 4641,
			"rx_dropped" : 0,
			"rx_errors" : 0,
			"rx_packets" : 26,
			"tx_bytes" : 690,
			"tx_dropped" : 0,
			"tx_errors" : 0,
			"tx_packets" : 9
		}
	},
	"memory_stats" : {
		"stats" : {
			"total_pgmajfault" : 0,
			"cache" : 0,
			"mapped_file" : 0,
			"total_inactive_file" : 0,
			"pgpgout" : 414,
			"rss" : 6537216,
			"total_mapped_file" : 0,
			"writeback" : 0,
			"unevictable" : 0,
			"pgpgin" : 477,
			"total_unevictable" : 0,
			"pgmajfault" : 0,
			"total_rss" : 6537216,
			"total_rss_huge" : 6291456,
			"total_writeback" : 0,
			"total_inactive_anon" : 0,
			"rss_huge" : 6291456,
			"hierarchical_memory_limit" : 67108864,
			"total_pgfault" : 964,
			"total_active_file" : 0,
			"active_anon" : 6537216,
			"total_active_anon" : 6537216,
			"total_pgpgout" : 414,
			"total_cache" : 0,
			"inactive_anon" : 0,
			"active_file" : 0,
			"pgfault" : 964,
			"inactive_file" : 0,
			"total_pgpgin" : 477
		},
		"max_usage" : 6651904,
		"usage" : 6537216,
		"failcnt" : 0,
		"limit" : 67108864
	},
	"blkio_stats" : {},
	"cpu_stats" : {
		"cpu_usage" : {
			"percpu_usage" : [8646879, 24472255, 36438778, 30657443],
			"usage_in_usermode" : 50000000,
			"total_usage" : 100215355,
			"usage_in_kernelmode" : 30000000
		},
		"system_cpu_usage" : 739306590000000,
		"throttling_data" : {
			"periods" : 0,
			"throttled_periods" : 0,
			"throttled_time" : 0
		}
	},
	"precpu_stats" : {
		"cpu_usage" : {
			"percpu_usage" : [8646879, 24350896, 36438778, 30657443],
			"usage_in_usermode" : 50000000,
			"total_usage" : 100093996,
			"usage_in_kernelmode" : 30000000
		},
		"system_cpu_usage" : 9492140000000,
		"throttling_data" : {
			"periods" : 0,
			"throttled_periods" : 0,
			"throttled_time" : 0
		}
	}
};

function sendStats(stats, container) {
	var name = container.options.metricSession + '.' + container.config.name + '.';

	Object.keys(stats.networks).forEach(function(key1) {
		Object.keys(stats.networks[key1]).forEach(function(key2) {
			var val = 0;
			if (!container._stats) {
				val = stats.networks[key1][key2];
			} else {
				val = stats.networks[key1][key2] - container._stats.networks[key1][key2];
			}
			statsD.increment(name + 'networks.' + key1 + '.' + key2, val);
		});
	});

	Object.keys(stats.memory_stats.stats).forEach(function(key2) {
		statsD.increment(name + 'memory_stats.stats.' + key2, stats.memory_stats.stats[key2]);
	});
	statsD.increment(name + 'memory_stats.max_usage', stats.memory_stats.max_usage);
	statsD.increment(name + 'memory_stats.usage', stats.memory_stats.usage);
	statsD.increment(name + 'memory_stats.failcnt', stats.memory_stats.failcnt);
	statsD.increment(name + 'memory_stats.limit', stats.memory_stats.limit);

	if (container._stats) {
		var cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
		var systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
		statsD.increment(name + 'cpu.percent', cpuDelta / systemDelta * 100);
	}

	container._stats = stats;
}

port.once('run', function() {

	port.docker.info(function(err, info) {
		if (err) {
			throw err;
		}

		var socket = io.connect(program.url, {
			query : 'token=' + program.token + '&id=' + info.ID
		});

		socket.on('connect', function() {
			console.log('authenticated');
			var _wait = wait;
			wati = [];
			_wait.forEach(function(item) {
				socket.emit('wait', item[0], item[1]);
			});
			console.log({
				address : program.address,
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
				'multiTenant' : program.multiTenant
			});
			socket.emit('init', {
				address : program.address,
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
				'multiTenant' : program.multiTenant
			});
		}).on('error', function(error) {
			throw error;
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

			if (program.stats) {
				data.stats = true;
			}
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
		port.on('stats', sendStats);

		process.on('SIGINT', function() {

			port.destroy(function(data) {
				socket.emit('exit');
				setTimeout(function() {
					process.exit(1);
				}, 1000);
			});
		});

	});
});
port.run();
