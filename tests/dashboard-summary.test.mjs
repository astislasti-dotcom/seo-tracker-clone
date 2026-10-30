// Offline tests for brand-scoped summaries used by the dashboard KPIs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DISPLAY, summarizeKeywords } from '../lib/keywords/measurements.mjs';

const kw = (domain, state, position = null, measured_at = null) => ({ domain, state, position, measured_at });

const SAMPLE = [
  kw('astisl.es', DISPLAY.RANKED, 4, '2026-10-08T06:00:00Z'),
  kw('astisl.es', DISPLAY.RANKED, 15, '2026-10-01T06:00:00Z'),
  kw('astisl.es', DISPLAY.NOT_FOUND, null, '2026-10-08T06:00:00Z'),
  kw('3av.events', DISPLAY.RANKED, 9, '2026-09-17T06:00:00Z'),
  kw('3av.events', DISPLAY.UNVERIFIED),
];

test('summary over all keywords counts each state', () => {
  const s = summarizeKeywords(SAMPLE);
  assert.equal(s.counts.total, 5);
  assert.equal(s.counts.ranked, 3);
  assert.equal(s.counts.top10, 2);
  assert.equal(s.counts.notFound, 1);
  assert.equal(s.counts.unverified, 1);
  assert.equal(s.averagePosition, 28 / 3);
});

test('summary scoped to one brand only uses that brand keywords', () => {
  const asti = summarizeKeywords(SAMPLE.filter((k) => k.domain === 'astisl.es'));
  assert.equal(asti.counts.total, 3);
  assert.equal(asti.counts.ranked, 2);
  assert.equal(asti.counts.top10, 1);
  assert.equal(asti.averagePosition, 9.5);

  const av = summarizeKeywords(SAMPLE.filter((k) => k.domain === '3av.events'));
  assert.equal(av.counts.total, 2);
  assert.equal(av.counts.ranked, 1);
  assert.equal(av.counts.unverified, 1);
});

test('brand with no verified positions has no top-10 zero and no average', () => {
  const s = summarizeKeywords([kw('3av.events', DISPLAY.UNVERIFIED), kw('3av.events', DISPLAY.NOT_FOUND, null, '2026-10-01T06:00:00Z')]);
  assert.equal(s.counts.ranked, 0);
  assert.equal(s.counts.top10, null);
  assert.equal(s.averagePosition, null);
});

test('last measured date is the most recent real date in the subset', () => {
  const s = summarizeKeywords(SAMPLE);
  assert.equal(s.lastMeasuredAt, '2026-10-08T06:00:00Z');
  const av = summarizeKeywords(SAMPLE.filter((k) => k.domain === '3av.events'));
  assert.equal(av.lastMeasuredAt, '2026-09-17T06:00:00Z');
});

test('empty subset yields zero keywords and no fabricated values', () => {
  const s = summarizeKeywords([]);
  assert.equal(s.counts.total, 0);
  assert.equal(s.counts.top10, null);
  assert.equal(s.averagePosition, null);
  assert.equal(s.lastMeasuredAt, null);
});
