import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {Surface,WorkspaceTabs} from './motion';

describe('workspace navigation',()=>{
  it('exposes the selected workspace and one shared selection indicator',()=>{
    const html=renderToStaticMarkup(<WorkspaceTabs value="advanced" onChange={()=>{}}/>);
    expect(html).toContain('aria-label="Workspace"');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-pressed="true"[^>]*>.*?Advanced/s);
    expect(html.match(/class="workspace-selection"/g)).toHaveLength(1);
    expect(html).toContain('AI Driving Coach');
  });
});

describe('floating surface semantics',()=>{
  it('preserves menu semantics and readable content on the first render',()=>{
    const html=renderToStaticMarkup(<Surface role="menu" aria-label="Session actions"><button role="menuitem">Edit details</button></Surface>);
    expect(html).toContain('role="menu"');
    expect(html).toContain('aria-label="Session actions"');
    expect(html).toContain('Edit details');
    expect(html).not.toContain('opacity:0');
    expect(html).not.toContain('inert');
  });
});
