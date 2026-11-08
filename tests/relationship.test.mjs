import test from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/automation/relationship-detector.mjs';
import { snap } from './fixtures/pages.mjs';

const state = s => classify(snap(s)).state;

test('Following / Follow / Requested', () => {
  assert.equal(state({ buttons: ['Following', 'Message'] }), 'FOLLOWING');
  assert.equal(state({ buttons: ['Follow'] }), 'NOT_FOLLOWING');
  assert.equal(state({ buttons: ['Follow Back'] }), 'NOT_FOLLOWING');
  assert.equal(state({ buttons: ['Requested'] }), 'REQUESTED');
  assert.equal(state({ buttons: ['Siguiendo'] }), 'FOLLOWING');
});

test('partial text matches never count: "Following list", "Follow us" are not relationship buttons', () => {
  assert.equal(state({ buttons: ['Following list', 'Follow us'] }), 'LOADING');
  assert.equal(state({ buttons: ['Message', 'Mute'] }), 'LOADING');
});

test('unavailable profile', () => {
  assert.equal(state({ bodyText: "Sorry, this page isn't available. The link you followed may be broken." }), 'UNAVAILABLE');
});

test('login required (form or login url)', () => {
  assert.equal(state({ hasLoginForm: true }), 'LOGIN_REQUIRED');
  assert.equal(state({ url: 'https://www.instagram.com/accounts/login/?next=/x/' }), 'LOGIN_REQUIRED');
});

test('safety messages win over everything but login', () => {
  assert.equal(state({ dialogText: 'Action Blocked. Try Again Later' }), 'ACTION_BLOCKED');
  assert.equal(state({ buttons: ['Following'], dialogText: 'We restrict certain activity to protect our community' }), 'ACTION_BLOCKED');
  assert.equal(state({ bodyText: 'Please confirm it\'s you' }), 'ACTION_BLOCKED');
  assert.equal(state({ dialogText: "confirm you're a human: security check" }), 'CAPTCHA');
  assert.equal(state({ hasLoginForm: true, dialogText: 'Try again later' }), 'LOGIN_REQUIRED');
});

test('a bio that mentions "try again later" does not trigger a false safety pause', () => {
  assert.equal(state({ buttons: ['Following'], bodyText: 'bio: no suspicious activity here, try again later' }), 'FOLLOWING');
});

test('follows-you / private are informational only', () => {
  const r = classify(snap({ buttons: ['Follow'], bodyText: 'Follows you', followsYou: true, isPrivate: true }));
  assert.equal(r.state, 'NOT_FOLLOWING');
  assert.equal(r.followsYou, true);
  assert.equal(r.isPrivate, true);
});
