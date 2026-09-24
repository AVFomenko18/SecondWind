import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

for (const file of ['index.html', 'department.html']) {
  test(file + ' inline scripts compile and event handlers resolve', () => {
    const html = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
    assert.ok(scripts.length > 0);
    for (const script of scripts) if (script[1].trim()) assert.doesNotThrow(() => new vm.Script(script[1]));
    const external = [...html.matchAll(/<script[^>]+src="([^"]+)"[^>]*><\/script>/g)]
      .map(match => readFileSync(new URL('../' + match[1], import.meta.url), 'utf8'));
    for (const script of external) assert.doesNotThrow(() => new vm.Script(script));
    const source = html + '\n' + external.join('\n');
    const names = [...html.matchAll(/on(?:click|submit|change|keydown|drop|dragstart|cancel)="([A-Za-z][A-Za-z0-9_]*)\(/g)].map(match => match[1]);
    for (const name of new Set(names)) {
      if (name === 'if') continue;
      assert.ok(new RegExp('function ' + name + '\\(').test(source), 'Missing handler: ' + name);
    }
  });
}
