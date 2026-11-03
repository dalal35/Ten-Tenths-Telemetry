import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
const local=(path:string)=>fileURLToPath(new URL(path,import.meta.url));
export default defineConfig({root:local('./'),publicDir:local('../../public'),plugins:[react()],server:{host:'127.0.0.1',port:4310,strictPort:true,fs:{allow:[local('../../')]}},build:{outDir:local('../../.tools/premium-ui-dist'),emptyOutDir:true}});
