import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const root=resolve('dist');const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
http.createServer(async(req,res)=>{try{const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const file=resolve(root,'.'+(path==='/'?'/index.html':path));if(!file.startsWith(root+'/'))throw Error();const bytes=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});res.end(bytes)}catch{res.writeHead(404);res.end('Not found')}}).listen(Number(process.env.PORT||3000),()=>console.log('Ruang Hari: http://localhost:'+(process.env.PORT||3000)));
