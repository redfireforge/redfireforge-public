import { describe, expect, it } from 'vitest';
import {
  assetUrl,
  buildLatestDemoJson,
  parseArgs,
  pickLearningHubUpdaterAssets,
} from './write-latest-demo-json.mjs';

describe('write-latest-demo-json', () => {
  it('parses CLI flags', () => {
    expect(parseArgs(['--dir', 'out', '--tag', 'v1.2.3', '--out', 'latest-demo.json', '--notes', 'hi'])).toEqual({
      dir: 'out',
      tag: 'v1.2.3',
      notes: 'hi',
      outFile: 'latest-demo.json',
    });
  });

  it('picks signed Learning Hub updater artifacts only', () => {
    const names = [
      'RedfireForge_1.2.3_aarch64.app.tar.gz',
      'RedfireForge-LearningHub-1.2.3-darwin-aarch64.app.tar.gz',
      'RedfireForge-LearningHub-1.2.3-darwin-aarch64.app.tar.gz.sig',
      'RedfireForge-LearningHub-1.2.3-darwin-x64.app.tar.gz',
      'RedfireForge-LearningHub-1.2.3-linux-amd64.AppImage.tar.gz',
      'RedfireForge-LearningHub-1.2.3-linux-amd64.AppImage.tar.gz.sig',
      'RedfireForge-LearningHub-1.2.3-windows-x64.exe',
      'RedfireForge-LearningHub-1.2.3-windows-x64.exe.sig',
    ];
    expect(pickLearningHubUpdaterAssets(names)).toEqual({
      'darwin-aarch64': {
        file: 'RedfireForge-LearningHub-1.2.3-darwin-aarch64.app.tar.gz',
        sig: 'RedfireForge-LearningHub-1.2.3-darwin-aarch64.app.tar.gz.sig',
      },
      'linux-x86_64': {
        file: 'RedfireForge-LearningHub-1.2.3-linux-amd64.AppImage.tar.gz',
        sig: 'RedfireForge-LearningHub-1.2.3-linux-amd64.AppImage.tar.gz.sig',
      },
      'windows-x86_64': {
        file: 'RedfireForge-LearningHub-1.2.3-windows-x64.exe',
        sig: 'RedfireForge-LearningHub-1.2.3-windows-x64.exe.sig',
      },
    });
  });

  it('returns null when no signed Learning Hub artifacts exist', () => {
    expect(buildLatestDemoJson({
      tag: 'v1.2.3',
      notes: 'notes',
      fileNames: ['RedfireForge-LearningHub-1.2.3-darwin-aarch64.dmg'],
      readSig: () => 'sig',
      pubDate: '2026-09-04T00:00:00.000Z',
    })).toBeNull();
  });

  it('builds latest-demo.json for signed platforms', () => {
    const json = buildLatestDemoJson({
      tag: 'v1.2.3',
      notes: 'Learning Hub',
      fileNames: [
        'RedfireForge-LearningHub-1.2.3-darwin-aarch64.app.tar.gz',
        'RedfireForge-LearningHub-1.2.3-darwin-aarch64.app.tar.gz.sig',
      ],
      readSig: () => '  SIGNATURE  \n',
      pubDate: '2026-09-04T00:00:00.000Z',
    });
    expect(json).toEqual({
      version: '1.2.3',
      notes: 'Learning Hub',
      pub_date: '2026-09-04T00:00:00.000Z',
      platforms: {
        'darwin-aarch64': {
          signature: 'SIGNATURE',
          url: assetUrl('v1.2.3', 'RedfireForge-LearningHub-1.2.3-darwin-aarch64.app.tar.gz'),
        },
      },
    });
  });
});
