'use strict';

const fastifyPlugin = require('fastify-plugin');
const uid = require('uid-safe').sync;
const cookieSignature = require('cookie-signature');

function session(fastify, opts, next) {
	fastify.addHook('preHandler', handleSession);

	const store = opts.store || new Store();
	fastify.decorateRequest('sessionStore', store);
	const cookieName = opts.cookieName || 'sessionId';
	const secret = opts.secret;
	const cookieOpts = opts.cookie || {};

	if (!secret) {
		next(new Error('the secret option is required!'));
		return;
	}

	function handleSession(request, reply, done) {
		const url = request.req.url;
		if (url.indexOf(cookieOpts.path || '/') !== 0) {
			done();
			return;
		}
		let sessionId = request.cookies[cookieName];
		if (!sessionId) {
			newSession(secret, reply, done);
		} else {
			const decryptedSessionId = cookieSignature.unsign(sessionId, secret);
			if (decryptedSessionId === false) {
				newSession(secret, reply, done);
			} else {
				store.get(decryptedSessionId, (err, session) => {
					if (err) {
						done(err);
						return;
					}
					if(!session) {
						done()
						return
					}
					session.expires = Date.now() + 900000;
					saveSession(decryptedSessionId, session, reply, done);
				});
			}
		}
	}

	function newSession(secret, reply, done) {
		const sessionId = uid(24);
		const encryptedSessionId = cookieSignature.sign(sessionId, secret);
		const session = new Session(encryptedSessionId, {}, Date.now() + 900000);
		saveSession(sessionId, session, reply, done);
	}

	function saveSession(sessionId, session, reply, done) {
		store.set(sessionId, session, (err) => {
			if (err) {
				done(err);
				return;
			}
			fastify.decorateRequest('session', session);
			const cookieOptions = getCookieOptions();
			reply.setCookie(cookieName, session.encryptedSessionId, cookieOptions);
			done();
		});
	}

	function getCookieOptions() {
		return {
			path: cookieOpts.path || '/',
			maxAge: cookieOpts.maxAge || null,
			httpOnly: cookieOpts.httpOnly || true,
			secure: cookieOpts.secure || true,
			expires: cookieOpts.expires || null,
			sameSite: cookieOpts.sameSite || null,
			domain: cookieOpts.domain || null
		};
	}

	next();
}

class Store {
	constructor() {
		this.store = {}
	}

	set(sessionId, session, callback) {
		this.store[sessionId] = session;
		callback();
	}

	get(sessionId, callback) {
		const session = this.store[sessionId];
		if (session && session.expires && session.expires <= Date.now()) {
			this.destroy(sessionId, callback);
			return;
		}
		callback(null, session);
	}

	destroy(sessionId, callback) {
		this.store[sessionId] = undefined;
		callback()
	}
}

class Session {
	constructor(encryptedSessionId, sessionData, expires) {
		this.encryptedSessionId = encryptedSessionId;
		this.sessionData = sessionData;
		this.expires = expires;
	}
}

exports = module.exports = fastifyPlugin(session, ">=0.30.2");
