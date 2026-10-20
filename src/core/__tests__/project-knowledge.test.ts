import test from 'node:test';
import assert from 'node:assert/strict';
import { publicationClusterForTopic, type TopicQueueItem } from '../project-knowledge.js';

test('subtopic publication cluster uses its narrow question while retaining seed query data', () => {
  const topic: TopicQueueItem = { slug: 'errors', url: '/guides/errors', kind: 'guide', role: 'sub', question: 'Какие ошибки допускают новички?', cluster: 'этапы продаж', queries: ['этапы продаж'] };
  assert.equal(publicationClusterForTopic(topic), 'Какие ошибки допускают новички');
  assert.deepEqual(topic.queries, ['этапы продаж']);
  assert.equal(publicationClusterForTopic({ ...topic, role: 'hub' }), 'этапы продаж');
});
