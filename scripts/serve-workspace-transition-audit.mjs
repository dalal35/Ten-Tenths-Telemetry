// Test-only Vite entry: production React app + native WebKit instrumentation.
// No native IPC is mocked. Use the existing debug app; do not package a build.
import {createServer} from 'vite';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const destination=new URL('../test-results/workspace-transitions/native-audit.json',import.meta.url);
const server=await createServer({
  plugins:[{
    name:'native-workspace-audit',
    // Vite 6 drops null inline overrides while merging the repository config.
    config(config){config.server??={};config.server.watch=null;},
    transformIndexHtml(){return [{tag:'script',attrs:{type:'module',src:'/tests/native-workspace-audit.ts'},injectTo:'head'}];},
    configureServer(vite){
      vite.middlewares.use('/__workspace-transition-audit',async(req,res)=>{
        if(req.method!=='POST'){res.statusCode=405;res.end();return;}
        try{
          let body='';for await(const chunk of req){body+=chunk;if(body.length>2_000_000)throw Error('Audit report too large');}
          const report=JSON.parse(body);
          await mkdir(new URL('../test-results/workspace-transitions/',import.meta.url),{recursive:true});
          await writeFile(destination,JSON.stringify(report,null,2));
          console.log(`Native audit saved: ${report.transitions?.length??0} transitions; ${report.failures?.length??0} failures`);
          res.setHeader('content-type','application/json');res.end('{"saved":true}');
        }catch(error){res.statusCode=400;res.end(String(error));}
      });
    },
  }],
  optimizeDeps:{noDiscovery:true,include:['react','react-dom/client','react/jsx-runtime','motion/react']},
  server:{host:'127.0.0.1',port:1420,strictPort:true,hmr:false},
});
assert.equal(server.config.server.watch,null,'Native timing audits must not scan build artifacts');
await server.listen();
console.log('Native workspace audit: http://127.0.0.1:1420/');
console.log('Alt+Shift+1–4: switch | P: pause next transition | →: step 55ms | R: all pairs + rapid | M: 600×500 constraint | S: save report');
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await server.close();process.exit(0);});
