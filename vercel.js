{
 "version":2
 "build":[
 {
  "src":"index.js",
  "use":"@vercel/node",
  "config": {includefiles": ["dist**"]}
 }
 ],
 "routes": [
   {
    "src": "/(.*)"
    "dest": "index.js"
   }
 }
 ]
 }
}