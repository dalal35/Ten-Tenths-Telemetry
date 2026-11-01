import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {WorkspaceTabs} from './motion';

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
