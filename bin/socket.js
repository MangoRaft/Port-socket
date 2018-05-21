//#!/usr/bin/env node

if (!('toJSON' in Error.prototype)) {
    Object.defineProperty(Error.prototype, 'toJSON', {
        value: function () {
            var alt = {};

            Object.getOwnPropertyNames(this).forEach(function (key) {
                alt[key] = this[key];
            }, this);

            return alt;
        },
        configurable: true,
        writable: true
    });
}
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

program.option('-u, --url [HOST]', 'HOST', 'http://127.0.0.1:8000');
program.option('-z, --zone [REGION]', 'Zone located in', 'far1');
program.option('-t, --token [TOKEN]', 'Token auth');
program.option('-e, --environment [ENVIROMENT]', 'environment to use', 'services');
program.option('-n, --name [NAME]', 'name to use', 'test');
program.option('-i, --id [ID]', 'id to use', 'test');
program.option('-m, --multi-tenant [MULTITENANT]', 'multiTenant', true);
program.option('-s, --stats [STATS]', false);
program.option('-a, --address [ADDRESS]', ip.address());
program.option('-b, --stats-host [HOST]', '127.0.0.1');
program.option('-c, --stats-port [PORT]', 8125);
program.parse(process.argv);
program.address = program.address || ip.address();
var wait = [];

var port = new Port({
    name: program.name,
    address: program.address,
    environment: program.environment,
    maxMemory: os.totalmem() / Math.pow(1024, 2),
    multiTenant: program.multiTenant,
    docker: {
        socket: '/var/run/docker.sock',
        //host : '127.0.0.1',
        //port : 4243,
    }
});
process.on('uncaughtException', function (err) {
    console.log(err);
});
port.on('error', function (err) {
    console.log(err);
});

function onError(err) {
    console.log(err);
    return err.toJSON ? err.toJSON() : err;
}

port.once('run', function () {

    port.docker.info(function (err, info) {
        if (err) {
            throw err;
        }

        var socket = io.connect(program.url, {
            query: 'token=' + program.token + '&id=' + program.id
        });

        socket.on('connect', function () {
            console.log('authenticated');
            wait.forEach(function (item) {
                socket.emit('wait', item[0], item[1]);
            });
            wati = [];

            var info = {
                address: program.address,
                name: program.name,
                id: program.id,
                hostname: os.hostname(),
                type: os.type(),
                platform: os.platform(),
                arch: os.arch(),
                release: os.release(),
                totalmem: os.totalmem(),
                freemem: os.freemem(),
                cpus: os.cpus(),
                environment: program.environment,
                zone: program.zone,
                name: program.name,
                memory: port.avalibale().memory,
                cores: port.avalibale().cores,
                'multiTenant': program.multiTenant
            };

            console.log(info);
            socket.emit('init', info);
        }).on('error', function (error) {
            console.log('error', error);
        });

        socket.on('version', function (cb) {
            debug('Container.version');

            port.docker.version(function (err, version) {
                if (err) {
                    return cb(onError(err));
                }
                cb(null, version);
            });
        });

        socket.on('info', function (cb) {
            debug('Container.info');

            port.docker.info(function (err, info) {
                if (err) {
                    return cb(onError(err));
                }
                cb(null, info);
            });
        });

        socket.on('resources', function (cb) {
            debug('Container.resources');
            var ids = Object.keys(port.container());
            cb(null, {
                memory: {
                    used: port.usagedMemory
                },
                cores: {
                    count: port.cores,
                    used: port.coresUsed,
                    avalibaleCPU: port.avalibaleCPU()
                },
                containers: {
                    count: ids.length,
                    ids: ids
                }
            });

        });

        socket.on('get', function (id, cb) {
            debug('Container.get');

            let container = port.container(id);
            if (!container) {
                return cb({
                    error: 'No container found'
                });
            }

            cb(null, {
                container: container.info
            });
        });

        socket.on('all', function (cb) {
            debug('Container.all');

            let containers = {};

            async.parallelLimit(Object.keys(port.container()).map(function (id) {
                return function (next) {
                    next(null, port.containers[id].info);
                };
            }), 5, function (errors, results) {
                cb(null, {
                    errors: errors,
                    containers: results
                });
            });
        });
        socket.on('start', async function (data, cb) {
            debug('Container.post');

            if (program.stats) {
                data.stats = true;
            }

            try {
                let container = await port.start(data);
                cb(null, container.info)
            } catch (err) {
                return cb(onError(err));
            }
        });
        socket.on('destroy', async function (data, cb) {
            debug('Container.distroy');

            try {
                let result = await port.destroy();
                cb(null, {
                    result: result
                });
            } catch (err) {
                return cb(onError(err));
            }
        });
        socket.on('stop', async function (id, cb) {
            debug('Container.del');
            let container = port.container(id);
            if (!container) {
                return cb({
                    error: 'No container found'
                });
            }

            try {
                await port.stop(id);
                cb();
            } catch (err) {
                return cb(onError(err));
            }
        });

        port.on('wait', function (container, result) {

            if (socket.connected)
                socket.emit('wait', container.info, result.StatusCode);
            else {
                wait.push([container.info, result.StatusCode]);
            }
        });

        port.on('state', function (state, container) {
            socket.emit('state', state, container.info);
        });
        if (program.stats) {
            port.on('stats', function sendStats(stats, container) {
                if (!container._stats) {
                    container._stats = new DStats({
                        host: program.statsHost,
                        port: program.statsPort,
                        key: container.options.metricSession + '.' + container.options.name + '.' + container.options.index
                    });
                }
                container._stats.stats(stats);
            });
        }
        process.on('SIGINT', async function () {
            socket.emit('exit');
            await port.destroy();
            setTimeout(function () {
                process.exit(1);
            }, 1000);
        });

    });
});
port.run();
