/* tiny-ps 
	
tiny-ps web component to display PostScript graphics inside HTML
Version 1.0.0 2025-02-12
Version 1.0.1 2025-02-21 added operators abs, clear, max, min, rand, sqrt
Version 1.0.2 2025-02-23 fixed bug in TTF reader

Renders as subset PostScript to Canvas, SVG and PDF (as well as an obsucre raw rendering).
The output can be displayed or proposed as downloadable link. It can be transparent.
The code is in the innerHMTL of the tiny-ps tag. 
The tag supports the attributes width, height, format, transparent, interval and oversampling.
The display is block by default, biut can be set to inline-block witch CSS.

The code is self contained and does not have dependencies. It is small (~ 150 KB).
Just add it at the end of the page. Everything is declarative.

If you want to display text, you need to place TrueType fonts in the same folder as the script.
A font series of Computer Modern (Sans Serif, Serif and Typewriter) is provided.
The font files have a reduced character set (only latin). 
You can replace them with any other font you like.

A good documentation of PostScipt operators can be found here:
https://hepunx.rl.ac.uk/~adye/psdocs/ref/REF.html

The software as is under the  MIT license
    
Copyright 2025 Matthias Bürcher, Lausanne, Switzerland (matti@belle-nuit.com)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
    
    
    If you have any bugs, please post an issue on Github
    https://github.com/bellenuit/tiny-ps
    
*/

/* DICTIONARY */

rpnFonts = {};
rpnFiles = {};
rpnFontBasePath = "";
rpnOperators = {};

/* DATA TYPES */

rpnHeapElement = class {
    constructor(x, type, heap) {
       this.value = x;
       this.type = type;
       this.counter = 0;
       this.heap = heap;
       for (let i = 0; i < heap.length; i++) {
         if (heap[i].value === null) {
             this.reference = i;
             this.heap[i] = this;
             return;
         }
       }
       this.reference = heap.length;
       this.heap.push(this);
    }
    inc() {
      this.counter++;
    }
    dec() {
      this.counter--;
      if (!this.counter) {
         const elem = this.heap[this.reference];
         if (Array.isArray(elem.value)) {
            for (let i = 0; i < elem.value.length; i++) {
                if (elem.value[i].reference) {
                  elem.value[i].reference.dec();
                }
            }
         }
         elem.value = null;
         this.heap = null; // destroy link
      }
    }
};

rpnArray = class {
   constructor(x, heap) {
      if (! Array.isArray(x)) throw "noarray";
      this.reference = new rpnHeapElement(x, "array", heap);
   }
   get type() { return "array"; }
   get dump() { if (this.value) {
     		return "[" + this.value.reduce((acc,x) => acc + x.dump + " ","").trim() + "]";
     	} else {
	     	return "";
     	}
   }
   get value() { return this.reference.value ; }
   replace(x) { this.reference.value = x; }
};

rpnDictionary = class {
   constructor() { this.value = {}; }
   get type() { return "dictionary"; }
   get dump() {
       const list = [];
       for (let key in this.value) {
           if (key != "context") {
                list.push(key + ": " + this.value[key].dump);
           }
       }
       return " { " + list.join(", ") + " } ";
  }
  copy() {
      const dict = new rpnDictionary(1);
       for (let key in this.value) {
           const v = this.value[key];
           switch (v.type)
           {
               case "dictionary" : dict[key] = v.copy(); break;
               case "array" : dict[key] = v.value.slice(); break;
               default: dict[key] = v.value;
           }
       }
       return dict;
  }
};

rpnError = class {
   constructor(x) { this.value = x; }
   get type() { return "error"; }
   get dump() { return "!" + this.value; }
};


rpnMark = class {
   constructor(x) { this.value = x; }
   get type() { return "mark"; }
   get dump() { return "[" ; }
};


rpnName = class {
   constructor(x) { this.value = x; }
   get type() { return "name"; }
   get dump() { return "/" + this.value; }
};


rpnNumber = class {
   constructor(x) { this.value = x;}
   get type() { return "number"; }
   get dump() {
       if (Math.abs(this.value) < 0.0000000001) return "0";
       return (Math.round(this.value * 1000000000.0) / 1000000000.0).toString();
   }
};


rpnProcedure = class {
   constructor(x) { this.value = x;}
   get type() { return "procedure"; }
   get dump() { return "{" + this.value + "}"; }
};

rpnString = class {
   constructor(x, heap) {
      if (typeof x != "string") throw "nostring";
      this.reference = new rpnHeapElement(x, "array", heap);
   }
   get type() { return "string"; }
   get dump() { return "(" + this.value + ")"; }
   get value() { return this.reference.value ; }
   replace(x) { this.reference.value = x; }
};

/* DEVICES */

rpnRawDevice = class {
    constructor(node, urlnode) {
        this.node = node;
        if (!this.node) this.node = document.createElement("CANVAS");
        this.urlnode = urlnode;
        this.imagestack = [];
        this.timer = null;
        this.finalround = false;
        if (this.node) this.clear(this.node.width, this.node.height, 1, 1);
    }
    finalize(context) {
        // stub 
    }

    clear(width, height, oversampling, transparent) {
        this.data = new Uint8ClampedArray(width * height * 4 * oversampling * oversampling);
        if (transparent == 0) {
            for (let i = 0; i < this.data.length; i++) this.data[i] = 255;
        }
        this.clipdata = new Uint8ClampedArray(width * height * 4 * oversampling * oversampling);
        this.clippath = "";
        for (let i = 0; i < this.clipdata.length; i++) this.clipdata[i] = 255;
        // touch interface only when changed
        if (width != this.node.width) this.node.width = width;
        if (height != this.node.height) this.node.height = height;
    }
    getFlatPath(path) {
        const flatpath = [];
        for (let subpath of path) {
            for (let line of subpath) {
                if (line[0] == "C") {
                    const lines = rpnBezier(line,-1);
                    for (let elem of lines) {
                        flatpath.push(elem);
                    }
                } else {
                    flatpath.push(line);
                }
            }
        }
        return flatpath;
    }
    clip(context) {
        const test = JSON.stringify(context.graphics.clip);
        if (this.clippath == test) return context;
        
        this.clipdata = new Uint8ClampedArray(this.data.length);
        for (let i = 0; i < this.clipdata.length; i++) this.clipdata[i] = 255;
        
        for (let clip of context.graphics.clip) {
            const flatpath = this.getFlatPath(clip);
            const newclip = new Uint8ClampedArray(this.data.length);
            this.clipdata = rpnScanFill(flatpath, context.width, context.height, [255,255,255,255], true, newclip, this.clipdata);
        }
        this.clippath = test;
        return context;
    }
    eofill(context) {
        return this.fill(context, false);
    }
    fill(context, zerowind = true) {
        if (context.device.raw + context.device.rawurl < 1) return context;
        const flatpath = this.getFlatPath(context.graphics.path);
        context = this.clip(context);
        this.data = rpnScanFill(flatpath, context.width, context.height, context.graphics.color, zerowind, this.data, this.clipdata);
        return context;
    }
    refresh() {
        // stub
    }
    stroke(context) {
        if (context.device.raw + context.device.rawurl < 1) return context;
        const w = context.graphics.linewidth / 2;
        const ad = Math.PI / 2;
        if (!w) return context;
        for (let subpath of context.graphics.path) {
            const subflatpath = this.getFlatPath([subpath]);
            var olda = [];
            var oldb = [];
            const fillpath = [];
            if (!subflatpath.length) continue;
            if (subflatpath[0][1] == subflatpath[subflatpath.length-1][3] && subflatpath[0][2] == subflatpath[subflatpath.length-1][4])
                subflatpath.push(subflatpath[0]);
            for (let line of subflatpath) {
                const [type, x0, y0, x1, y1] = line;
                const a = Math.atan2(y1 - y0, x1 - x0);
                const x0a = x0 + Math.cos(a - ad) * w;
                const y0a = y0 + Math.sin(a - ad) * w;
                const x1a = x1 + Math.cos(a - ad) * w;
                const y1a = y1 + Math.sin(a - ad) * w;
                const x0b = x0 + Math.cos(a + ad) * w;
                const y0b = y0 + Math.sin(a + ad) * w;
                const x1b = x1 + Math.cos(a + ad) * w;
                const y1b = y1 + Math.sin(a + ad) * w;
                fillpath.push(["L", x0a, y0a, x1a, y1a]);
                fillpath.push(["L", x1a, y1a, x1b, y1b]);
                fillpath.push(["L", x1b, y1b, x0b, y0b]);
                fillpath.push(["L", x0b, y0b, x0a, y0a]);

                
                if (olda.length) {
                    const [xa, ya] = rpnLineIntersection(olda[1],olda[2],olda[3],olda[4],x0a, y0a, x1a, y1a);
                    const [xb, yb] = rpnLineIntersection(oldb[1],oldb[2],oldb[3],oldb[4],x0b, y0b, x1b, y1b);
                    if (xa !== null && xb !== null) {
                        fillpath.push(["L", olda[3],olda[4], xa, ya]);
                        fillpath.push(["L", xa, ya, x0a, y0a]);
                        fillpath.push(["L", x0a, y0a, x0b, y0b]);
                        fillpath.push(["L", x0b, y0b, xb, yb]);
                        fillpath.push(["L", xb, yb, oldb[3], oldb[4]]);
                        fillpath.push(["L", oldb[3], oldb[4], olda[3], olda[4]]);
                    }
                }
                olda = ["L", x0a, y0a, x1a, y1a];
                oldb = ["L", x0b, y0b, x1b, y1b];
            }
            context = this.clip(context);
            this.data = rpnScanFill(fillpath, context.width, context.height, context.graphics.color, true, this.data, this.clipdata);
        }
        return context;
    }
    showpage(context) {
        if (context.device.raw + context.device.rawurl < 1) {
            this.node.style.display = "none";
            if (this.urlnode) this.urlnode.style.display = "none";
            return context;
        } 
        this.node.style.display = (context.device.raw) ? "block" : "none";
        const image = new ImageData(this.data, context.width * context.device.oversampling);
        const canvas = (this.node) ? this.node : document.createElement("CANVAS");
        const ctx = canvas.getContext("2d");
        if (context.device.oversampling > 1) {
            const nodebig = document.createElement("CANVAS");
            nodebig.width = context.width * context.device.oversampling;
            nodebig.height = context.height * context.device.oversampling;
            nodebig.getContext("2d").putImageData(image, 0,0);
            const nodesmall = document.createElement("CANVAS");
            nodesmall.width = context.width;
            nodesmall.height = context.height;
            const nodectx = nodesmall.getContext("2d");
            nodectx.scale(1/context.device.oversampling, 1/context.device.oversampling);
            nodectx.imageSmoothingEnabled = true;
            nodectx.imageSmoothingQuality = "high";
            nodectx.drawImage(nodebig,0,0);
            this.imagestack.push(nodectx.getImageData(0,0, context.width, context.height));
        } else {
            this.imagestack.push(new ImageData(this.data, context.width * context.device.oversampling));
        }
        if (context.device.raw) {
            if (! this.timer) this.timer = setInterval ( () => {
                const imagedata = this.imagestack.shift();
                if (imagedata) {
                    const ctx = this.node.getContext("2d");
                    ctx.putImageData(imagedata, 0,0);
                }
                if (this.finalround && this.imagestack.length == 0)
                    clearInterval(this.timer);
            }, context.device.interval );
        }
        if (this.urlnode && context.device.rawurl) {
            this.urlnode.style.display = "block";
            ctx.putImageData(this.imagestack[this.imagestack.length-1], 0,0);
            const url = canvas.toDataURL();
            this.urlnode.href = url;
            this.urlnode.setAttribute("download", "PS.png");
            if (context.shadow) context.shadow.innerHTML = this.urlnode.outerHTML;
        } else {
            if (this.urlnode)  this.urlnode.style.display = "none";
        }
        this.clear(this.node.width, this.node.height, context.device.oversampling, context.device.transparent);
        return context;
    }

};

rpnCanvasDevice = class {
    constructor(node, urlnode) {
        this.node = node;
        if (!node) document.createElement("CANVAS");
        this.urlnode = urlnode;
        this.clippath = "";
        this.ctx = null;
        this.imagestack = [];
        this.timer = null;
        this.finalround = false;
    }
    finalize(context) {
        this.finalround = true;
    }
    clear(width, height, oversampling, transparent) {
        this.node.width = width;
        this.node.height = height;
        const node = document.createElement("CANVAS");
        node.width = width;
        node.height = height;
        this.ctx = node.getContext("2d");
        this.ctx.clearRect(0, 0, width, height);
        if (transparent == 0) {
            this.ctx.fillStyle = "white";
            this.ctx.fillRect(0, 0, width, height);
        }
        this.oversampling = oversampling;
        this.transparent = transparent;
    }
    refresh() {
        // stub
    }
    applyPath(path) {
        if (!this.ctx) this.clear(this.node.width, this.node.height, this.oversampling, this.transparent);
        this.ctx.beginPath();
        for (let subpath of path) {
           if (!subpath.length) continue;
           this.ctx.moveTo(subpath[0][1], this.node.height - subpath[0][2]);
           for (let line of subpath) {
               if (line[0] == "C") {
                   this.ctx.bezierCurveTo(line[3],  this.node.height - line[4], line[5],  this.node.height - line[6], line[7],  this.node.height - line[8]);
               } else {
                  this.ctx.lineTo(line[3],  this.node.height - line[4]);
                  if (line[0] == "Z") this.ctx.closePath();
               }
           }
        } 
    }
    clip(context) {
        if (!this.ctx) this.clear(this.node.width, this.node.height, this.oversampling, this.transparent);
        for (let clip of context.graphics.clip) {
            this.applyPath(clip);
            this.ctx.clip();
        }
        return context;
    }
    eofill(context) {
        return this.fill(context, false);
    }
    fill(context, zerowind = true) {
        if (context.device.canvas + context.device.canvasurl < 1) return context;
        if (context.device.canvas) this.node.style.display = "block";
        if (!this.ctx) this.clear(this.node.width, this.node.height, this.oversampling, this.transparent);
        this.ctx.save();
        context = this.clip(context);
        this.applyPath(context.graphics.path);
        this.ctx.fillStyle = "rgb("+Math.round(context.graphics.color[0])+" "+Math.round(context.graphics.color[1])+" "+ Math.round(context.graphics.color[2])+")";
        this.ctx.globalAlpha = context.graphics.color[3]/255.0;
        if (zerowind) {
            this.ctx.fill("nonzero");
        } else {
            this.ctx.fill("evenodd");
        }
        this.ctx.restore();
        return context;
    }
    stroke(context) {
        if (context.device.canvas + context.device.canvasurl < 1) return context;
        if (!this.ctx) this.clear(this.node.width, this.node.height, this.oversampling, this.transparent);
        this.ctx.save();
        context = this.clip(context);
        this.applyPath(context.graphics.path);
        this.ctx.strokeStyle = "rgb("+Math.round(context.graphics.color[0])+" "+Math.round(context.graphics.color[1])+" "+ Math.round(context.graphics.color[2])+")";
        this.ctx.globalAlpha = context.graphics.color[3]/255.0;
        this.ctx.lineWidth = context.graphics.linewidth;
        this.ctx.stroke();
        this.ctx.restore();
        return context;
    }
    showpage(context) {
        if (context.device.canvas + context.device.canvasurl < 1) {
            this.node.style.display = "none";
            if (this.urlnode) this.urlnode.style.display = "none";
            return context;
        }
        this.node.style.display = (context.device.canvas) ? "block" : "none";
        
        if (context.device.canvasurl && this.urlnode) {
            this.urlnode.style.display = "block";
            const url = this.ctx.canvas.toDataURL();
            this.urlnode.href = url;
            this.urlnode.setAttribute("download", "PS.png");
            } else {
            if (this.urlnode) this.urlnode.style.display = "none";
        }
        if (context.device.canvas && this.node) {
            this.imagestack.push(this.ctx.getImageData(0, 0, context.width, context.height));
            if (! this.timer) this.timer = setInterval ( () => {
                const imagedata = this.imagestack.shift();
                if (imagedata) {
                    const ctx = this.node.getContext("2d");
                    ctx.putImageData(imagedata, 0,0);
                }
                if (this.finalround && this.imagestack.length == 0)
                    clearInterval(this.timer);
        }, context.device.interval );
        }
        this.ctx = null;
        return context;
    }
    

};


rpnPDFDevice = class {
    constructor(node, urlnode) {
        this.node = node;
        if (!this.node) this.node = document.createElement("IMG");
        this.urlnode = urlnode;
        this.clear(this.node.width, this.node.height, 1, 1);
        this.canshow = true;
        this.catalog = {};
        this.pageslist = {};
        this.pages = [];
        this.streams = [];
        this.alphas = [];
        this.elements = [];
        this.usedfonts = {};
        this.currentfont = {};
        this.imagestack = [];
        this.timer = null;
        this.finalround = false;
        
    }
    clear(width, height, oversampling, transparent) { 
        if (Number.isFinite(width*1)) this.width = width;
        if (Number.isFinite(height*1)) this.height = height;
        this.node.style.backgroundColor = (transparent == 0) ? "white" : "transparent";  
    }
    finalize(context) {
        if (context.device.pdf + context.device.pdfurl < 1) return context; 
        const objects = [];
        this.catalog.Type = "/Catalog";
        this.catalog.Pages = "2 0 R ";
        objects.push([this.catalog]);

        this.pageslist.Type = "/Pages";
        this.pageslist.Kids = "[ ";
        for (let i = 0; i < this.pages.length; i++)
            this.pageslist.Kids += (20+i)+" 0 R ";
        this.pageslist.Kids += "]";
        this.pageslist.Count = this.pages.length;
        this.pageslist.MediaBox = "[0 0 " + this.width + " " + this.height + "]"; 
        objects.push([this.pageslist]);

        for (let i = 0; i < 17; i++)
            objects.push(this.alphas[i]);

        var i = 0 ;
        for (let dict of this.pages) {
            i++;
            dict[0].Contents = (19 + this.pages.length + i)+" 0 R";
            objects.push(dict);
        }
        for (let dict of this.streams)
            objects.push(dict);


        const xrefoffset = [];
        var file = "%PDF-1.1" + rpnEndOfine; // signature
        file +=  "%¥±ë rpn" + rpnEndOfine; // random binary characters 
        
        for (let k in objects) {    
     const o = objects[k];
            xrefoffset.push(file.length);
            file += xrefoffset.length + " 0 obj" + rpnEndOfine;
            file += this.objectDict(o[0]) + rpnEndOfine;
            if (o.length == 2) {
                file += "stream" + rpnEndOfine;
                file += o[1] + rpnEndOfine;
                file += "endstream" + rpnEndOfine;
            }
            file += "endobj" + rpnEndOfine + rpnEndOfine;
        }
        
        
        const startxref = file.length;

        file += "xref" + rpnEndOfine;
        file += "0 6" + rpnEndOfine;
        file += "0000000000 65535 f" + rpnEndOfine;
        for (let i in xrefoffset) {
            const x = new Intl.NumberFormat('en-IN', { minimumIntegerDigits: 10 , useGrouping: false}).format(xrefoffset[i]);
            file += x + ' 00000 n ' + rpnEndOfine;
        }

        // trailer
        const trailderdict = {};
        trailderdict.Root = "1 0 R";
        trailderdict.Size = 5;
        file += "trailer " + this.objectDict(trailderdict) + rpnEndOfine;
        file += 'startxref'+ rpnEndOfine;
        file += startxref + rpnEndOfine;
        file +='%%EOF' + rpnEndOfine;
        const url = "data:application/pdf;base64," + btoa(file);
       
        

        if (context.device.pdfurl && this.urlnode) {
            this.urlnode.href = url;
            this.urlnode.style.display = (context.device.pdfurl) ? "block" : "none";
            this.urlnode.setAttribute("download", "PS.pdf");
        }
        if (context.device.pdf && this.node) {
            this.node.src = url;
            this.node.style.display = "block";
            this.node.style.display = (context.device.pdf) ? "block" : "none";
            this.node.width = this.width;
            this.node.height = this.height;
        } 
    } 
    numberFormat(z) {
        return Intl.NumberFormat('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(z);
    }
    asciiHexEncode(buffer) {
       const data = new Array(buffer.length);
       for (let i=0; i < buffer.length; i++) {
           data[i] = ("0" + (buffer.codePointAt(i).toString(16))).substr(0,2);
       }
       return data.join(" ")+rpnEndTag;
    }
    objectDict(obj) {
       const elements = [];
       for (let k in obj) {
           const v = obj[k];
           if (typeof v == "object") {
               elements.push("/" + k + " " + this.objectDict(v));
           } else {
               elements.push("/" + k + " " + v);
           } 
       }
       return "<< " + elements.join(" ") + " >> ";
    }
    getPath(path, close = true) {
       const p = [];
       for (let subpath of path) {
           if (!subpath.length) continue;
           p.push(this.numberFormat(subpath[0][1]) + " " + this.numberFormat(subpath[0][2]) + " m");
           for (let line of subpath) {
               if (line[0] == "C") {
                   p.push(this.numberFormat(line[3]) + " " + this.numberFormat(line[4]) + " " + this.numberFormat(line[5]) + " " + this.numberFormat(line[6]) + " " + this.numberFormat(line[7]) + " " + line[8] + " c");
               } else {
                   p.push(this.numberFormat(line[3]) + " " + this.numberFormat(line[4]) + " l");
                  if (line[0] == "Z") p.push("h");
               }
           }
        } 
        if (close) p.push("h");
        return p.join(" ");
    }
    clip(context) {
        this.elements.push("q");
        for (let clip of context.graphics.clip) {
            this.elements.push(this.getPath(clip));
            this.elements.push("W n");
        }
        return context;
    }
    eofill (context) {
        return this.fill(context, false);
    }
    fill(context, zerowind = true) {
        if (context.device.pdf + context.device.pdfurl < 1) return context;
        if (context.device.textmode * context.showmode) return context;
        if (context.graphics.clip.length) context = this.clip(context);
        this.elements.push(this.getPath(context.graphics.path));
        this.setcolor(context);
        this.setalpha(context);
        if (zerowind) {
            this.elements.push("f");
        } else {
            this.elements.push("f*");
        }
        if (context.graphics.clip.length) this.elements.push("Q");
        return context;
    }
    refresh() {
        // stub
    }
    setcolor(context) {
        const rs = this.numberFormat(context.graphics.color[0]/255);
 const gs = this.numberFormat(context.graphics.color[1]/255);
 const bs = this.numberFormat(context.graphics.color[2]/255);
        this.elements.push(rs+' '+gs+' '+bs+' rg');
        this.elements.push(rs+' '+gs+' '+bs+' RG');
    }
    setalpha(context)
    {
        const gs = Math.round(context.graphics.color[3]/16)
        this.elements.push("/GS"+gs+" gs");
    }
    setfont(context) {
        const f = {};
        f.Type = "/Font";
        f.Subtype = "/Type1";
        f.Encoding = "/rpnMacRomanEncoding";
        f.BaseFont = "/" + context.graphics.font;
 
 const key = f.BaseFont;
 var k;
  
 if (Object.prototype.hasOwnProperty(this.usedfonts, key)) {
     k = this.usedfonts[key].key;
        } else {
     k = Object.keys(this.usedfonts).length + 1;
     f.key = k;
     this.usedfonts[key] = f;
        }
 if (f != this.currentfont) {
     this.currentfont = f;
     this.elements.push("BT /F" + k + "  " + this.numberFormat(context.graphics.size) + " Tf ET"); }

    }
    show(s, context, targetwidth = 0, extraspace = 0) {
        if (context.device.pdf + context.device.pdfurl < 1) return context;
        if (context.graphics.clip.length) context = this.clip(context);
        this.setfont(context);
        this.setcolor(context);
        this.setalpha(context);
        const matrix = context.graphics.matrix.slice();
        const decomposed = rpnDecompose2dMatrix(matrix);
        const s2 = rpnMacRomanEncoding(s);
        if (decomposed.rotation) {
             const tmatrix = [ 1, 0, 0, 1, this.numberFormat(context.graphics.current[0]), this.numberFormat (context.graphics.current[1])];
             const rmatrix = [ this.numberFormat (Math.cos(decomposed.rotation)), this.numberFormat (Math.sin(decomposed.rotation)), this.numberFormat(-Math.sin(decomposed.rotation)), this.numberFormat(Math.cos(decomposed.rotation)), 0, 0];
             this.elements.push("q " + tmatrix.join(" ") + " cm " + rmatrix.join(" ") + " cm");
             this.elements.push("BT 0 0 Td " + extraspace + " Tw (" + s2 + ") Tj ET");
             this.elements.push ("Q");
             
        } else {
            this.elements.push("BT " + this.numberFormat(context.graphics.current[0]) + " " + this.numberFormat(context.graphics.current[1]) + " Td " + extraspace + " Tw (" + s2 + ") Tj ET");
        }
        if (context.graphics.clip.length) this.elements.push("Q");
        return context;
    }
    showpage(context) {
         const dict = {};
        dict.Type = "/Page";
        dict.Parent = "2 0 R";
        const ressourcesdict = {};
        const fontdict= {};
        for (let k in this.usedfonts) {    
     const f = this.usedfonts[k];
            const substitute = rpnFontSubstitution(f.BaseFont);
            f.BaseFont = substitute;
            fontdict["F" + f.key] = f;
        }
        ressourcesdict.Font = fontdict;
        const alphadict = {};
        ressourcesdict.ExtGState = alphadict;
        dict.Resources = ressourcesdict;
       
        this.pages.push([dict]);

        for (let i = 0; i < 17; i++ ) {
            alphadict["GS"+i] = (3+i) + " 0 R";
            const ad = {};
            ad.type = "/ExtGState";
            ad.ca = i / 16.0;
            ad.CA = i / 16.0;
            this.alphas.push([ad])
        }


        const streamdict = {};
        const stream = this.elements.join(rpnEndOfine);
        this.elements = [];
        streamdict.Length = stream.length;
        this.streams.push([streamdict, stream]);


        return context;
    }
    stroke(context) {
        if (context.device.pdf + context.device.pdfurl < 1) return context;
        if (context.graphics.clip.length) context = this.clip(context);
        this.elements.push(this.getPath(context.graphics.path, false));
        this.setcolor(context);
        this.setalpha(context);
        const ws = this.numberFormat(context.graphics.linewidth);
 this.elements.push(ws+' w');
        this.elements.push("S");
        if (context.graphics.clip.length) this.elements.push("Q");
        return context;
    }
};

rpnSVGDevice = class {
    constructor(node, urlnode) {
        this.node = node;
        this.canshow = true;
        this.fonts = {};
        if (!node) this.node = document.createElement("SVG");
        this.node.setAttribute("xmlns","http://www.w3.org/2000/svg");
        this.urlnode = urlnode;
        this.imagestack = [];
        this.timer = null;
        this.finalround = false;
        this.clear( 590, 330, 1, 1);
    }
    finalize(context) {
        this.finalround = true;
    }
    refresh() {
        if (this.node.style.display == "block") {
        this.node.style.display='none';
        this.node.offsetHeight;
        this.node.style.display='block';
        }
        // https://martinwolf.org/before-2018/blog/2014/06/force-repaint-of-an-element-with-javascript/
    }
    clear(width, height, oversampling, transparent) {
        if (Number.isFinite(width)) {
            this.node.setAttribute("width",width+"px");
            this.width = width;
        } 
        if (Number.isFinite(height)) {
            this.node.setAttribute("height",height+"px");
            this.height = height;
        }
        if (Number.isFinite(width) && Number.isFinite(height))         
        this.node.setAttribute("viewbox", "0 0 " + width+" " + height);
        this.node.style.backgroundColor = (transparent != 0) ? "transparent" : "white";
        this.clippath = "";
        this.clippathsource = "";
        while(this.node.firstChild) this.node.removeChild(this.node.lastChild);
        this.oversampling = oversampling;
        this.transparent = transparent
        this.ctx = true;

    }
    getPath(path, close = true) {
       const p = [];
       if (!path.length) return "";
       for (let subpath of path) {
           if (!subpath.length) continue;
           p.push("M " + (subpath[0][1]) + " " + (this.height - subpath[0][2]));
           for (let line of subpath) {
               if (line[0] == "C") {
                   p.push("C " +(line[3]) + " " + (this.height - line[4]) + " " + (line[5]) + " " + (this.height - line[6]) + " " +(line[7]) + " " + (this.height - line[8]));
               } else {
                   p.push("L "+(line[3]) + " " + (this.height - line[4]));
                   if (line[0] == "Z") p.push("Z"); 
                }
           }
        } 
        if (close) p.push("Z");
        return p.join(" ");
    }
    clip(context) {
        if (!this.ctx) this.clear(this.width, this.height, this.oversampling, this.transparent);
        const test = JSON.stringify(context.graphics.clip);
        if (this.clippathsource == test) return context;
        this.clippath = "";
        this.clippathsource == test;
        for (let clip of context.graphics.clip) {
            const node = document.createElement("CLIPPATH");
            if (this.clippath) node.setAttribute("clip-path", "url(#"+this.clippath+")");
            this.clippath = "clippath"+this.node.childElementCount;
            node.setAttribute("id", this.clippath);
            const node2 = document.createElement("PATH");
            node2.setAttribute("d", this.getPath(clip));
            node.appendChild(node2);
            this.node.appendChild(node);
        }
       
        return context;
    }
    eofill (context) {
        return this.fill(context, false);
    }
    fill(context, zerowind = true) {
        if (context.device.svg + context.device.svgurl < 1) return context;
        if (context.device.textmode * context.showmode) return context;
        if (context.device.svg) this.node.style.display = "block";
        if (!this.ctx) this.clear(this.width, this.height, this.oversampling, this.transparent);
        context = this.clip(context);
        const node = document.createElement("PATH");
        node.setAttribute("id","fill"+this.node.childElementCount);
        node.setAttribute("d", this.getPath(context.graphics.path));
        node.setAttribute("stroke","none");
        node.setAttribute("fill", "rgb(" + Math.round(context.graphics.color[0]) + ", " + Math.round(context.graphics.color[1]) + ", " + Math.round(context.graphics.color[2]) + ")");
        node.setAttribute("fill-opacity", context.graphics.color[3]/255.0);
        if (this.clippath) node.setAttribute("clip-path", "url(#"+this.clippath+")");
        if (zerowind) {
            node.setAttribute("fill-rule", "nonzero");
        } else {
            node.setAttribute("fill-rule", "evenodd");
        } 
        this.node.appendChild(node);
        return context;
    }
    stroke(context) {
        if (context.device.svg + context.device.svgurl < 1) return context;
        if (context.device.svg) this.node.style.display = "block";
        if (!this.ctx) this.clear(this.width, this.height, this.oversampling, this.transparent);
context = this.clip(context);
        const node = document.createElement("PATH");
        node.setAttribute("id","stroke" + this.node.childElementCount);
        node.setAttribute("d", this.getPath(context.graphics.path, false));
        node.setAttribute("fill","none");
        node.setAttribute("stroke-width",context.graphics.linewidth);
        node.setAttribute("stroke", "rgb(" + Math.round(context.graphics.color[0]) + ", " + Math.round(context.graphics.color[1]) + ", " + Math.round(context.graphics.color[2]) + ")");
        node.setAttribute("stroke-opacity", context.graphics.color[3]/255.0);
        if (this.clippath) node.setAttribute("clip-path", "url(#"+this.clippath+")");
        this.node.appendChild(node);
        return context;
    }
    show(s, context, targetwidth = 0) {
        if (context.device.svg + context.device.svgurl < 1) return context;
        if (context.device.svg) this.node.style.display = "block";
        if (!Object.prototype.hasOwnProperty(this.fonts, context.graphics.font)) {
            this.fonts[context.graphics.font] = context.graphics.font;
        }
        if (!this.ctx) this.clear(this.width, this.height, this.oversampling, this.transparent);
        context = this.clip(context);
        const node = document.createElement("TEXT");
        node.setAttribute("x", "0");
        node.setAttribute("y", "0");
        node.setAttribute("font-family", context.graphics.font);
        node.setAttribute("font-size", context.graphics.size);
        node.setAttribute("fill", "rgb(" + Math.round(context.graphics.color[0]) + ", " + Math.round(context.graphics.color[1]) + ", " + Math.round(context.graphics.color[2]) + ")" );
        node.setAttribute("fill-opacity", context.graphics.color[3]/255.0);
        if (this.clippath) node.setAttribute("clip-path", "url(#"+this.clippath+")");
        const matrix = context.graphics.matrix.slice();
        const decomposed = rpnDecompose2dMatrix(matrix);
        const x = context.graphics.current[0];
        const y = context.height - context.graphics.current[1];
        node.setAttribute("text-anchor","start");
        node.setAttribute("transform", "translate(" + x + " " + y  +") rotate(" +  -decomposed.rotation*180/Math.PI + ")" );
        if (targetwidth) {
            node.setAttribute("textLength", targetwidth);
            node.setAttribute("lengthAdjust", "spacing");
        }
        node.innerHTML = rpnHtmlSpecialChars(s); // clean XML
        this.node.appendChild(node);
        return context;
    }
    showpage(context) {
        if (context.device.svg + context.device.svgurl < 1) {
            this.node.style.display = "none";
            if (this.urlnode) this.urlnode.style.display = "none";
            return context;
        } 
        const node = document.createElement("DEFS");
        this.node.insertBefore(node, this.node.firstChild);
        for (const font in this.fonts) {
            const style = document.createElement("STYLE");
            const src = readSyncDataURL(rpnFontBasePath + font + ".ttf", "font/ttf");
            style.innerHTML = "@font-face { font-family: '" + font + "'; font-weight: normal; src:  url('" + src + "') format('truetype')} }";
            node.appendChild(style);
        }
        const shadow = context.shadow;
        if (context.device.svg && this.node) {
            this.imagestack.push(this.node.outerHTML.slice());
            if (! this.timer) this.timer = setInterval ( () => {
                shadow.innerHTML = this.imagestack.shift(); 
                if (this.finalround && this.imagestack.length == 0)
                    clearInterval(this.timer);
                }, context.device.interval );
        }
        if (context.device.svgurl && this.urlnode) {
            const file = rpnStartTag + "?xml version='1.0' encoding='UTF-8'?" + rpnEndTag + this.node.outerHTML;
            const url = "data:image/svg+xml;base64," + btoa(file);
            this.urlnode.href = url;
            this.urlnode.setAttribute("download", "PS.svg");
        } 
        this.node.style.display = (context.device.svg) ? "block" : "none";
        if (this.urlnode) 
         this.urlnode.style.display = (context.device.svgurl) ? "block" : "none";
        this.ctx = null;
        return context;
    }
};

/* CONTEXT */

rpnContext = class {
    constructor() {
        this.source = [];
        this.stack = [];
        this.heap = [];
        this.lasterror = "";
        this.currentcode = "";
        this.width = 600;
        this.height = 800;
        this.dictstack = [];
        this.dictstack.push({});
        this.nodes = [];
        this.fontdict = {};
        this.device = { canvas: 0, canvasurl: 0, console: 1, interval: 0, oversampling: 1, pdf: 0, pdfurl: 0, raw: 1, rawurl : 0, svg: 0, svgurl: 0, textmode: 0,  transparent: 0  };
        this.async = true;
        this.initgraphics();
    }
    get dict() {
        return this.dictstack[this.dictstack.length - 1];
    }
    get graphics() {
        return this.graphicsstack[this.graphicsstack.length - 1];
    }
    error(s) {
        this.lasterror = s;
        this.stack.push(new rpnError(s));
        return this;
    }
    finalize() {
       for (let n of this.nodes) n.finalize(this);
    }
    refresh() {
        for (let n of this.nodes) n.refresh();
    }
    initgraphics () {
        this.graphicsstack = [];
        this.graphicsstack.push({ path: [], clip: [], current: [], color: [0, 0, 0, 255], linewidth: 1, matrix : [1, 0, 0, 1, 0, 0] , font: "", size: 12, cachedevice : [0, 0, 0, 0, 0, 0] });
    }
    itransform(x,y) {
       const m = this.graphics.matrix;
       const det = m[0]*m[3] - m[1]*m[2];
       return [ (x*m[3] - y*m[2] +m[2]*m[5] - m[4]*m[3])/det, 
(-x*m[1] + y*m[0] + m[4]*m[1] - m[0]*m[5])/det ];
    }
    pop(...parameters) {
        if (this.stack.length < parameters.length) {
            this.error("stackunderflow");
            return [];
        }
        const result = [];
        for (let p of parameters) {
            const data = this.stack.pop();
            if (p == "any") {
                result.push(data);
            } else if (p.includes(data.type)) {
                result.push(data);
            } else {
                this.error("typeerror");
                return [];
            }
         }
         return result;
    }
    popArray() {
        var found = false;
        var arr = [];
        while (this.stack.length && ! found) {
            const value = this.stack.pop();
            if (value.type == "mark") {
                found = true;
            } else {
                arr.push(value);
            }   
        }
        if (! found) {
            return this.error("stackunderflow");
        }
        arr.reverse();
        const a = new rpnArray(arr, this.heap);
        a.reference.inc();
        this.stack.push(a);
    }
    transform(x,y) {
       const m = this.graphics.matrix;
       return [ x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5] ];
    }
};

/* PARSER AND EVALUATOR */


rpn = function(s, context = null, outerContext = false ) {
    if (!context) {
        context = new rpnContext();
    }
    const list = s.concat(" ").split("");
    var state = "start";
    var current = "";
    var depth = 0;
    for (let elem of list) {
        if (context.lasterror) {
           return context;
        }
        context.currentcode += elem;
        switch (state) {
            case "start":
                if (/[0-9-.]/.test(elem)) {
                    state = "number";
                    current = elem;
                } else if (/[a-zA-Z]/.test(elem)) {
                    state = "operator";
                    current = elem;
                }  else if (elem == "/") {
                    state = "namestart";
                }  else if (elem == "{") {
                    state = "procedure";
                }  else if (elem == "(") {
                    state = "string";
                }  else if (elem == "[") {
                    context.stack.push(new rpnMark()); //mark
                }  else if (elem == "]") {
                    context.popArray();
                }  else if (elem == "%") {
                    state = "comment";
                }  else if (elem.trim() === '') {
                    // ignore whitespace
                }  else  {
                    context.error("syntaxerror");
                } 
                break;
            case "number":
                if (/[0-9]/.test(elem)) {
                    current += elem;
                } else if (elem == ".") {
                    state = "fraction";
                    current += elem;
                } else if (/[a-zA-Z-]/.test(elem)) {
                    context.error("syntaxerror");
                }  else if (elem.trim() === "") {
                    context.stack.push(new rpnNumber(parseFloat(current)));
                    state = "start";
                    current = "";
                } else if (elem == "]") {
                    context.stack.push(new rpnNumber(parseFloat(current)));
                    state = "start";
                    current = "";
                    context.popArray();
                } else if (elem == "/") {
                    context.stack.push(new rpnNumber(parseFloat(current)));
                    state = "name";
                    current = "";
                }  else {
                    context.error("syntaxerror");
                }
                break;
            case "fraction":
                if (/[0-9]/.test(elem)) {
                    current += elem;
                } else if (elem.trim() === "") {
                    context.stack.push(new rpnNumber(parseFloat(current)));
                    state = "start";
                    current = "";
               } else if (elem == "]") {
                    context.stack.push(new rpnNumber(parseFloat(current)));
                    state = "start";
                    current = "";
                    context.popArray();
                } else if (elem == "/") {
                    context.stack.push(new rpnNumber(parseFloat(current)));
                    state = "name";
                    current = "";
               } else {
                    context.error("syntaxerror");
               }
               break;
            case "operator":
                if (/[a-zA-Z0-9]/.test(elem)) {
                    current += elem;
                } else if (elem.trim() !== "" && elem != "]"){
                    context.error("syntaxerror");
                } else {
                    var data = context.dict[current];
                    if (!data) {
                        for (let i = context.dictstack.length - 1; i >= 0; i--) {
                            data = context.dictstack[i][current];
                            if (data) {
                                i = 0; // break
                            }
                        }
                    }
                    const op = rpnOperators[current];
                    if (data) {
                       if (data.type == "procedure") {
                          context = rpn(data.value, context);
                       } else if (data.type == "array"){
                            data.reference.inc();
                            context.stack.push(data);
                       } else if (data.type == "string"){
                            data.reference.inc();
                            context.stack.push(data);
                       } else {
                            context.stack.push(data);
                       }
                    } else if (op) {
                       context = op(context);
                    } else {
                    context.error("syntaxerror");
                    }
                    state = "start";
                    current = "";
                    if (elem == "]") {
                       context.popArray();
                    }

                }
                break;
           case "namestart":
                if (/[a-zA-Z.]/.test(elem)) {
                    state = "name";
                    current = elem;
                } else {
                    context.error("syntaxerror");
                }
                break;
            case "name":
                if (/[a-zA-Z0-9-.]/.test(elem)) {
                    current += elem;
                } else if (elem.trim() === "") {
                    context.stack.push(new rpnName(current));
                    state = "start";
                    current = "";
               } else if (elem == "]") {
                    context.stack.push(new rpnName(current));
                    state = "start";
                    current = "";
                    context.popArray();
               } else  {
                    context.error("syntaxerror");
               }
                break;
            case "procedure":
               if (elem == "}") {
                   if (depth) {
                      depth--;
                      current += elem;
                   } else {
                        context.stack.push(new rpnProcedure(current));
                        state = "start";
                        current = "";
                   }
               } else if (elem == "{") {
                  depth++;
                  current += elem;
               } else {
                   current += elem;
               }
               break;
           case "string":
               if (elem == ")") {
                   if (depth) {
                      depth--;
                      current += elem;
                   } else {
                        const s = new rpnString(current, context.heap);
                        s.reference.inc();
                        context.stack.push(s);
                        state = "start";
                        current = "";
                   }
               } else if (elem == "(") {
                  depth++;
                  current += elem;
               } else {
                   current += elem;
               }
               break;
           case "comment":
             if (elem == rpnEndOfine ) {
                state = "start";
             }
        } // switch state
    } // for
    if (state !== "start") {
       context.error("syntaxerror");
    }
    if (outerContext) context.finalize();
    return context;
};


/* RAW FUNCTIONS */


rpnBezier = function (curve, depth = -1) {
    const [ type, x0, y0, x1, y1, x2, y2, x3, y3 ] = curve;
    // distance of points to line
    var d1 = 0;
    var d2 = 0;
    if (x0 == x3) {
        d1 = Math.abs(x1 - x0);
        d2 = Math.abs(x2 - x0);
    } else {
        const m = (y3 - y0) / (x3 - x0);
        const p = y0 - m * x0;
        d1 = Math.abs(y1 - m * x1 - p) /  Math.sqrt(1 + m*m);
        d2 = Math.abs(y2 - m * x2 - p) /  Math.sqrt(1 + m*m);
    }
    if (d1 < 1 && d2 < 1) {
        return [ [ "L", x0, y0, x3, y3 ] ];
    }
    if (!depth) return [ [ "L", x0, y0, x3, y3 ] ];
 
    const x4 =  (x0 + x1) / 2;
    const y4 =  (y0 + y1) / 2;
    const x5 =  (x1 + x2) / 2;
    const y5 =  (y1 + y2) / 2;
    const x6 =  (x2 + x3) / 2;
    const y6 =  (y2 + y3) / 2;
    const x7 =  (x4 + x5) / 2;
    const y7 =  (y4 + y5) / 2;
    const x8 =  (x5 + x6) / 2;
    const y8 =  (y5 + y6) / 2;
    const x9 =  (x7 + x8) / 2;
    const y9 =  (y7 + y8) / 2;

    return rpnBezier(["C", x0, y0, x4, y4, x7, y7, x9, y9], depth - 1).concat(rpnBezier(["C", x9, y9, x8, y8, x6, y6, x3, y3], depth - 1));};

rpnLineIntersection = function(x1, y1, x2, y2, x3, y3, x4, y4) {
    // https://en.wikipedia.org/wiki/Line–line_intersection
   const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
   if (!denom) return ([null,null]);
   const nom1 = x1 * y2 - y1 * x2;   const nom2 = x3 * y4 - y3 * x4;   const x = (nom1 * (x3 - x4) - nom2 * (x1 - x2)) / denom;
   const y = (nom1 * (y3 - y4) - nom2 * (y1 - y2)) / denom;
   return [x, y];
};

rpnMatrixMultiplication = function (a, b) {
   const c = new Array(6);
   c[0] = a[0] * b[0] + a[1] * b[2] ;
   c[1] = a[0] * b[1] + a[1] * b[3] ;
   c[2] = a[2] * b[0] + a[3] * b[2] ;
   c[3] = a[2] * b[1] + a[3] * b[3] ;
   c[4] = a[4] * b[0] + a[5] * b[2] ;
   c[5] = a[4] * b[1] + a[5] * b[3] ;
   return c;
};

rpnDecompose2dMatrix=function(mat) {
  /* https://stackoverflow.com/questions/12469770/get-skew-or-rotation-value-from-affine-transformation-matrix */
  var a = mat[0];
  var b = mat[1];
  var c = mat[2];
  var d = mat[3];
  var e = mat[4];
  var f = mat[5];

  var delta = a * d - b * c;

  let result = {
    translation: [e, f],
    rotation: 0,
    scale: [0, 0],
    skew: [0, 0],
  };

  // Apply the QR-like decomposition.
  if ((a != 0) + (b != 0)) {
    var r = Math.sqrt(a * a + b * b);
    result.rotation = b > 0 ? Math.acos(a / r) : -Math.acos(a / r);
    result.scale = [r, delta / r];
    result.skew = [Math.atan((a * c + b * d) / (r * r)), 0];
  } else if ((c != 0) + (d != 0)) {
    var s = Math.sqrt(c * c + d * d);
    result.rotation =
      Math.PI / 2 - (d > 0 ? Math.acos(-c / s) : -Math.acos(c / s));
    result.scale = [delta / s, s];
    result.skew = [0, Math.atan((a * c + b * d) / (s * s))];
  } else {
    // a = b = c = d = 0
  }

  return result;
};

rpnScanFill = function (path, width, height, color, zerowind, data, clipdata) {
   const crossings = [];   const oversampling = Math.sqrt(data.length / width / height / 4);   const width2 = width * oversampling;
   const height2 = height * oversampling;
   for (let line of path) {
      var [type, x0, y0, x1, y1] = line;
      x0 *= oversampling;
      y0 *= oversampling;
      x1 *= oversampling;
      y1 *= oversampling;
      const dx = x1 - x0;
      const dy = y1 - y0;
      const up = (dy > 0) ? 0.5 : 0.0;
      if (dy) {
          if (y1 < y0) {
              [y0, y1] = [y1, y0];
              [x0, x1] = [x1, x0];
          }
          const ex = dx / dy;
          const y0c = Math.ceil(y0);
          x = (x0 + ex * (y0c - y0));
          for (let y = y0c; y < y1; y++) {
              if (y >= 0 && y < height2) {
                 if (! crossings[y] ) crossings[y] = [];
                 crossings[y].push(Math.floor(x) + up);
              }
              x += ex;
          }
       }
    }

    for (let y in crossings) {
       const arr = crossings[y];
       arr.sort(function (a, b) { return a - b; });
       var odd = 0;
       for (let i = 0; i < arr.length - 1; i++) {
          if (zerowind) {
              let up = 2 * (arr[i] - Math.floor(arr[i]));
              odd += up ? 1 : -1;
          } else {
              odd = 1 - odd;
          }
          if (odd) {
          var xstart = Math.floor(arr[i]);
          var xend = Math.floor(arr[i + 1]);
          var offset = ((height2 - 1 - y) * width2 + xstart) * 4;
          for (let j = xstart; j < xend; j++) {
              // we must check bounds 0 <= j < width2
              if (j >= 0 && j < width2 && clipdata[offset] ) {                 
                  // Da = C1a + C2a * (1 - C1a) 
                  const da = color[3]/255.0 + data[offset + 3]/255.0 * (1 -  color[3]/255.0);
                  for (let c = 0; c < 3; c++) {
                      // D = C1 * C1a + C2 * C2a * (1 - C1a)
                      data[offset + c] = color[c] * color[3]/255.0 + data[offset + c] * data[offset + 3] / 255.0 * (1 - color[3]/255.0)  ;
                      if (da) data[offset + c] /= da;
                  }
                  data[offset + 3] = 255.0 * da;
              }
              offset += 4;
          }
          }
       } 
    }

    return data;

};

/* UNIT TEST */

rpnUnitTest = function (input, output) {
   context = rpn(input);
   result = context.stack.reduce((acc,v) => acc + v.dump + " " , " ").trim();
   if (result == output) {
       check = "ok";
   } 
   else
   {
       check = "not ok (" + result + ")";
       console.log(input + " => " + output + " : " + check);
   }
   
};

rpnUnitTest("123","123");
rpnUnitTest("-123","-123");
rpnUnitTest("1c","!syntaxerror");
rpnUnitTest("1.","1");
rpnUnitTest("1.1","1.1");
rpnUnitTest("1.1.","!syntaxerror");
rpnUnitTest("1.1a","!syntaxerror");
rpnUnitTest("/name","/name");
rpnUnitTest("/n2","/n2");
rpnUnitTest("/n.","/n.");
rpnUnitTest("[ 1 2 3 ]","[1 2 3]");
rpnUnitTest("[1 2 3]","[1 2 3]");
rpnUnitTest("{1 2 3}","{1 2 3}");
rpnUnitTest("(abc)","(abc)");
rpnUnitTest("(ab(abc)c)","(ab(abc)c)");
rpnUnitTest("(ab(abc","!syntaxerror");
rpnUnitTest("(ab(abc)","!syntaxerror");
rpnUnitTest("(ab)abc)","(ab) !syntaxerror");
rpnUnitTest("[(abc) 2 3 [4 5]]","[(abc) 2 3 [4 5]]");

rpnOperators.abs = function(context) {
    const [a] = context.pop("number");
    if (!a) return context;
    context.stack.push(new rpnNumber(Math.abs(a.value)));
    return context;
};
rpnUnitTest("2 abs","2");
rpnUnitTest("-2 abs","2");
rpnUnitTest("(2) abs","!typeerror");
rpnUnitTest("abs","!stackunderflow");

rpnOperators.add = function(context) {
    const [b, a] = context.pop("number", "number");
    if (!b) return context;
    context.stack.push(new rpnNumber(a.value + b.value));
    return context;
};
rpnUnitTest("2 3 add","5");
rpnUnitTest("2 0 add","2");
rpnUnitTest("2 -3 add","-1");
rpnUnitTest("2 (a) add","2 !typeerror");
rpnUnitTest("(a) 2 add","!typeerror");
rpnUnitTest("2 add","2 !stackunderflow");
rpnUnitTest("add","!stackunderflow");

rpnOperators.and = function(context) {
    const [b, a] = context.pop("number", "number");
    if (!b) return context;
    context.stack.push(new rpnNumber(a.value && b.value ? 1 : 0));
    return context;
};rpnUnitTest("2 2 and","1");
;

rpnUnitTest("2 0 and","0");rpnUnitTest("2 -1 and","1");rpnUnitTest("2 (a) and","2 !typeerror");
rpnUnitTest("(a) 2 and","!typeerror");
;

rpnUnitTest("2 and","2 !stackunderflow");rpnUnitTest("and","!stackunderflow");

rpnOperators.arc = function(context) {
    const [angle2, angle1, radius, centery, centerx] = context.pop("number","number","number","number","number");
    if (!centerx) return context;

    // assure angle2 > angle1!
    while (angle2.value <= angle1.value) angle2.value += 360;
    
    // approximation works for 90 dregrees max, we split
    var first = true;
    var target = angle1.value;
    const subpath = [];
    
    while(angle1.value < angle2.value) {
         
        target = angle1.value + Math.min(90, angle2.value - target);   // starting point
        let [x1, y1] = [centerx.value + radius.value * Math.cos(angle1.value * Math.PI/180), centery.value + radius.value * Math.sin(angle1.value * Math.PI/180)];
        // end point
        let [x4, y4] = [centerx.value + radius.value * Math.cos(target * Math.PI/180), centery.value + radius.value * Math.sin(target * Math.PI/180)];
        // control points
        let lt = radius.value * (target-angle1.value)/90 * 4 /3 * (Math.sqrt(2)-1) ;
        let [x2, y2] = [x1 + lt * Math.cos((angle1.value + 90)*Math.PI/180), y1 + lt * Math.sin((angle1.value + 90)*Math.PI/180)];
        let [x3, y3] = [x4 + lt * Math.cos((target - 90)*Math.PI/180), y4 + lt * Math.sin((target - 90)*Math.PI/180)];
        let [x1t, y1t] = context.transform(x1, y1);
        let [x2t, y2t] = context.transform(x2, y2);
        let [x3t, y3t] = context.transform(x3, y3);
        let [x4t, y4t] = context.transform(x4, y4);
        if (context.graphics.current.length) {
            subpath.push(["L", context.graphics.current[0], context.graphics.current[1], x1t, y1t]);
        }
        subpath.push(["C", x1t, y1t, x2t, y2t, x3t, y3t, x4t, y4t]);
        angle1.value += 90;
        context.graphics.current = [ x4t, y4t ];
    }
    context.graphics.path.push(subpath);
    return context;
};

rpnOperators.arcto = function(context) {
    const [r, y2, x2, y1, x1] = context.pop("number","number","number","number","number");
    if (!x1) return context;
    if (!context.graphics.current.length) {
       context.error("nocurrentpoint");
       return context;
    }
    const [x0, y0] = context.itransform(context.graphics.current[0], context.graphics.current[1]);
 
    var a1 = Math.atan2(y1.value - y0, x1.value - x0);
    if (a1 < 0) a1 += 2 * Math.PI;
    const xt1 = x1.value - Math.cos(a1) * r.value;
    const yt1 = y1.value - Math.sin(a1) * r.value;
    var a2 = Math.atan2(y2.value - y1.value, x2.value - x1.value);
    if (a2 < 0) a2 += 2 * Math.PI;
    const xt2 = x1.value + Math.cos(a2) * r.value;
    const yt2 = y1.value + Math.sin(a2) * r.value;
    const lt = Math.abs(r.value * 4 /3 * (Math.sqrt(2)-1)) ;
    const xc2 = xt1 + Math.cos(a1) * lt;
    const yc2 = yt1 + Math.sin(a1) * lt;
    const xc3 = xt2 - Math.cos(a2) * lt;
    const yc3 = yt2 - Math.sin(a2) * lt;

    const subpath = context.graphics.path.pop();

    const [x1p, y1p] = context.transform(xt1, yt1);
    const [x2p, y2p] = context.transform(xc2, yc2);
    const [x3p, y3p] = context.transform(xc3, yc3);
    const [x4p, y4p] = context.transform(xt2, yt2);
    subpath.push(["L", context.graphics.current[0], context.graphics.current[1], x1p, y1p]);
    subpath.push(["C", x1p, y1p, x2p, y2p, x3p, y3p, x4p, y4p]);
    context.graphics.path.push(subpath);
    context.graphics.current = [x4p, y4p];
    context.stack.push(new rpnNumber(xt1));
    context.stack.push(new rpnNumber(yt1));
    context.stack.push(new rpnNumber(xt2));
    context.stack.push(new rpnNumber(yt1));
    return context;
};

rpnOperators.array = function(context) {
    const [n] = context.pop("number");
    if (!n) return context;
    if (n.value < 1) {
        context.error("limitcheck");
        return context;
    }
    const a = [];
    for (let i = 0; i < n.value; i++) {
        a.push(new rpnNumber(0));
    }
    context.stack.push(new rpnArray(a, context.heap));
    return context;
};
rpnUnitTest("3 array","[0 0 0]");
rpnUnitTest("-3 array","!limitcheck");
rpnUnitTest("0 array","!limitcheck");
rpnUnitTest("array","!stackunderflow");


rpnOperators.atan = function(context) {
    const [denum, num] = context.pop("number","number");
    if (!num) return context;
    context.stack.push(new rpnNumber(Math.atan2(num.value,denum.value) * 180 / 3.1415926536 ));
    return context;
};

rpnUnitTest("100 atan","100 !stackunderflow");
rpnUnitTest("(a) 100 atan","!typeerror");
rpnUnitTest("atan","!stackunderflow");


rpnOperators.begin = function(context) {
    const [d] = context.pop("dictionary");
    if (!d) return context;
    context.dictstack.push(d.value);
    return context;
};

rpnOperators.bind = function(context) {
    // Expands all defined rpnOperators in procedure. We ignore that operator for the moment
    return context;};
rpnOperators.charpath = function(context) {
    const [s] = context.pop("string");
    if (!context.graphics.current.length) {
       context.error("nocurrentpoint");
       return context;
    }
    if (!context.graphics.font) {
       context.error("nocurrentfont");
    }
    if (!s) return context;
    const font = rpnFonts[context.graphics.font];
    const scale = context.graphics.size / font.head.unitsPerEm;
    var ps = " currentpoint currentpoint translate currentmatrix " + scale + " " + scale + " scale ";
    for (let i = 0; i < s.value.length; i++) {
        const c = s.value.charCodeAt(i);
        const gi = font.glyphIndex(c);
        ps += font.glyphPath(gi);
        ps += font.glyphWidth(gi) + " 0 translate ";
    }
    ps += " setmatrix neg exch neg exch translate ";
    context = rpn(ps, context);
    return context;
};

rpnOperators.clear = function(context) {
    context.stack = [];
    return context;};

rpnOperators.clip = function(context) {
    context.graphics.clip.push(context.graphics.path.slice());
    return context;};

rpnOperators.closepath = function(context) {
    if (!context.graphics.current.length) {
       context.stack.push(new rpnError("nocurrentpoint"));
    } else if (!context.graphics.path.length) {
       context.stack.push(new rpnError("nocurrentpath"));
    } else {
      if (context.graphics.path.length) {
         const subpath = context.graphics.path.pop();
         const x0 = subpath[0][1];
         const y0 = subpath[0][2];
         subpath.push( [ "Z",context.graphics.current[0], context.graphics.current[1], x0, y0 ]);
         context.graphics.path.push(subpath);
         context.graphics.current = [ x0, y0 ];
         }
    }
    return context;
};

// unit tests require moveto, moved there
rpnUnitTest("50 50 closepath","50 50 !nocurrentpoint");
rpnOperators.copy = function(context) {
    const [n] = context.pop("number");
    if (!n) return context.error("stackunderflow");
    if (n.value < 1) return context.error("rangerror");
    if (n.value > context.stack.length) return context.error("stackunderflow");
    const arr = [];
    for (let i = 0; i < n.value; i++ ) {
        arr.push(context.stack.pop());
    }
    arr.reverse();
    context.stack = context.stack.concat(arr).concat(arr);
    return context;
};
rpnUnitTest("1 2 3 3 copy","1 2 3 1 2 3");


rpnOperators.cos = function(context) {
    const [a] = context.pop("number");
    if (!a) return context;
    context.stack.push(new rpnNumber(Math.cos(a.value * 3.1415926536 / 180)));
    return context;
};
rpnUnitTest("30 cos","0.866025404");
rpnUnitTest("0 cos","1");
rpnUnitTest("-30 cos","0.866025404");
rpnUnitTest("(a) cos","!typeerror");
rpnUnitTest("cos","!stackunderflow");

rpnOperators.count = function(context) {
    context.stack.push(new rpnNumber(context.stack.length));
    return context;
};

rpnOperators.currentalpha = function(context) {
    const a = context.graphics.color[3];
    context.stack.push(new rpnNumber(a.value/255.0));
    return context;
};

rpnOperators.currentdict = function(context) {
    const d = new rpnDictionary(1);
    d.value = context.dict;
    context.stack.push(d);
    return context;
};

rpnOperators.currentgray = function(context) {
    const [r, g, b] = context.graphics.color;
    const y = (0.30*r + 0.61*g +0.09*b) / 255.0;
    context.stack.push(new rpnNumber(y));
    return context;
};
rpnUnitTest("currentgray","0");

rpnOperators.currentlinewidth = function(context) {                   
    context.stack.push(new rpnNumber(context.graphics.linewidth));
    return context;
};
rpnUnitTest("currentlinewidth","1");
rpnOperators.currentmatrix = function(context) {
    const m = [];
    for (let v of context.graphics.matrix) {
        m.push(new rpnNumber(v));
    }
    context.stack.push(new rpnArray(m, context.heap));
    return context;
};
rpnUnitTest("currentmatrix","[1 0 0 1 0 0]");

rpnOperators.currentpoint = function(context) {
    if (!context.graphics.current.length) {
       context.stack.push(new rpnError("nocurrentpoint"));
       return context;
    }
    const [x, y] = context.itransform(context.graphics.current[0], context.graphics.current[1]);
    context.stack.push(new rpnNumber(x));
    context.stack.push(new rpnNumber(y));
    return context;
};

rpnOperators.currentrgbcolor= function(context) {
    const [r, g, b] = context.graphics.color;
    context.stack.push(new rpnNumber(r.value/255.0));
    context.stack.push(new rpnNumber(g.value/255.0));
    context.stack.push(new rpnNumber(b.value/255.0));
    return context;
};

rpnOperators.curveto = function(context) {
    const [y3, x3, y2, x2, y1, x1] = context.pop("number","number","number","number","number","number");
    if (!y3) return context;
    if (!context.graphics.current.length) {
       context.stack.push(new rpnError("nocurrentpoint"));
    } else if (!context.graphics.path.length) {
       context.stack.push(new rpnError("nocurrentpath"));
    } else {
      const subpath = context.graphics.path.pop();
      const [x1t, y1t] = context.transform(x1.value, y1.value);
      const [x2t, y2t] = context.transform(x2.value, y2.value);
      const [x3t, y3t] = context.transform(x3.value, y3.value);
      subpath.push([ "C", context.graphics.current[0], context.graphics.current[1], x1t, y1t, x2t, y2t, x3t, y3t ]);
      context.graphics.path.push(subpath);  
      context.graphics.current = [ x3t, y3t ];
    }
    return context;
};
rpnUnitTest("100 90 50 90 50 50 curveto","!nocurrentpoint");
rpnUnitTest("(a) 100 90 50 90 50 curveto","!typeerror");
rpnUnitTest("100 90 50 90 50 curveto","100 90 50 90 50 !stackunderflow");

rpnOperators.def = function(context) {
    const [b, a] = context.pop("any", "name");
    if (!b) return context;
    if (context.dict[a.value]) {
       const old = context.dict[a.value];
       if (old.type == "array") old.reference.dec();
       if (old.type == "string") old.reference.dec();
    }
    // we do not inc() or dec() for the new, because reference count stays
    context.dict[a.value] = b;
    return context;};rpnUnitTest("/foo 1 def 2 foo","2 1");
rpnUnitTest("/foo (abc) def 2 foo","2 (abc)");
rpnUnitTest("/foo { 72 add } def 2 foo","74");
rpnUnitTest("2 3 def","!typeerror");
rpnUnitTest("2 def","2 !stackunderflow");
rpnUnitTest("def","!stackunderflow");
rpnUnitTest("/a (abc) def /b a def /a (def) def b a","(abc) (def)");
rpnUnitTest("/foo 1 def currentdict", "{ foo: 1 }");

rpnOperators.definefont = function(context) {
    const [d, n] = context.pop("dictionary", "name");
    if (!n) return context;
    // we should check here for the keys present
    context.fontdict[n.value] = d;
    return context;
};

rpnOperators.dict = function(context) {
    const [n] = context.pop("number");
    if (!n) return context;
    context.stack.push(new rpnDictionary(n));
    return context;
};
// rpnUnitTest("1 dict", "{ }")
rpnUnitTest("1 dict begin /foo 1 def currentdict", "{ foo: 1 }");

rpnOperators.div = function(context) {
    const [b, a] = context.pop("number", "number");
    if (!b) return context;
    context.stack.push(new rpnNumber(a.value / b.value));
    return context;
};
rpnUnitTest("2 3 div","0.666666667");
rpnUnitTest("2 0 div","Infinity");
rpnUnitTest("2 -3 div","-0.666666667");
rpnUnitTest("2 (a) div","2 !typeerror");
rpnUnitTest("(a) 2 div","!typeerror");
rpnUnitTest("2 div","2 !stackunderflow");
rpnUnitTest("div","!stackunderflow");

rpnOperators.dup = function(context) {
    const [a] = context.pop("any");
    if (!a) return context;
    if (a.type == "array") a.reference.inc();
    if (a.type == "string") a.reference.inc();
    context.stack.push(a);
    context.stack.push(a);
    return context;
};
rpnUnitTest("1 dup","1 1");
rpnUnitTest("(a) dup","(a) (a)");
rpnUnitTest("[2 3] dup","[2 3] [2 3]");
rpnUnitTest("dup","!stackunderflow");

rpnOperators.end = function(context) {
    if (context.dictstack.length < 2) {
        context.error("dictstackunderflow");
        return context;
    }
    context.dictstack.pop();
    return context;
};
rpnUnitTest("/foo 1 def 1 dict begin /bar 2 def end currentdict", "{ foo: 1 }");

rpnOperators.eofill = function(context) {
    for (let n of context.nodes) context = n.eofill(context);
    context.graphics.path = [];
    context.graphics.current = [];
    return context;};
rpnOperators.eq = function(context) {
    const [b, a] = context.pop("number,string", "number,string");
    if (!b) return context;
    if (a.type != b.type) {
       return context.error("typeerror");
    }
    context.stack.push(new rpnNumber(a.value == b.value ? 1 : 0));
    return context;
};
rpnUnitTest("2 2 eq","1");
rpnUnitTest("2 3 eq","0");
rpnUnitTest("2 0 eq","0");rpnUnitTest("2 -1 eq","0");
rpnUnitTest("2 (a) eq","!typeerror");
rpnUnitTest("(a) 2 eq","!typeerror");
rpnUnitTest("2 eq","2 !stackunderflow");
rpnUnitTest("eq","!stackunderflow");

rpnOperators.exch = function(context) {
    const [b, a] = context.pop("any", "any");
    if (!b) return context;
    context.stack.push(b);
    context.stack.push(a);
    // reference count does not change
    return context;
};
rpnUnitTest("2 3 exch","3 2");
rpnUnitTest("2 0 exch","0 2");
rpnUnitTest("2 -3 exch","-3 2");
rpnUnitTest("2 (a) exch","(a) 2");
rpnUnitTest("(a) 2 exch","2 (a)");
rpnUnitTest("2 exch","2 !stackunderflow");
rpnUnitTest("exch","!stackunderflow");

rpnOperators.exec = function(context) {
    const [e] = context.pop("procedure");
    if (!e) return context.error("xchec");
    context = rpn(e.value,context);
    return context;
};
rpnUnitTest("2 { 3 add } exec ","5");

rpnOperators.exit = function(context) {
    context.error("exit");
    return context;
};

rpnOperators.false = function(context) {
    context.stack.push(new rpnNumber(0));
    return context;
};
rpnUnitTest("false","0");


rpnOperators.findfont = function(context) {
    const [n] = context.pop("name");
    if (!n) return context;
    if (!rpnFonts[n.value]) {
        rpnFonts[n.value] = new rpnTTF(rpnFontBasePath + n.value + ".ttf");
    }
    if (!rpnFonts[n.value]) {
        context.error("invalidfont " );
        return context;
    }
    if (rpnFonts[n.value].error) {
        context.error("invalidfont " + rpnFonts[n.value].error );
        return context;
    }
    const dict = new rpnDictionary(1);
    dict.value.FontName = n;
    context.stack.push(dict);
    return context;
};


rpnOperators.fill = function(context) {
    for (let n of context.nodes) context = n.fill(context);
    context.graphics.path = [];
    context.graphics.current = [];
    return context;};
rpnUnitTest("fill","");

rpnOperators.for = function(context) {
    const [proc, limit, increment, initial] = context.pop("procedure", "number", "number", "number");
    if (!initial) return context;
    if (! increment.value) {
        context.error("limitcheck");
        return context;
    }
    if (increment.value > 0) {
        for (let i = initial.value; i <= limit.value; i+= increment.value) {
            context.stack.push(new rpnNumber(i));
            context = rpn(proc.value, context);
        }
    } else {
        for (let i = initial.value; i >= limit.value; i+= increment.value) {
            context.stack.push(new rpnNumber(i));
            context = rpn(proc.value, context);
       }
    }
    return context;
};
rpnUnitTest("0 1 1 5 { add } for", "15");

rpnOperators.ge = function(context) {
    const [b, a] = context.pop("number,string", "number,string");
    if (!b) return context;
    if (a.type != b.type) {
       return context.error("typeerror");
    }
    context.stack.push(new rpnNumber(a.value >= b.value ? 1 : 0));
    return context;
};
rpnUnitTest("2 2 ge","1");
rpnUnitTest("2 3 ge","0");
rpnUnitTest("2 0 ge","1");
rpnUnitTest("2 -1 ge","1");
rpnUnitTest("2 (a) ge","!typeerror");
rpnUnitTest("(a) 2 ge","!typeerror");
rpnUnitTest("2 ge","2 !stackunderflow");
rpnUnitTest("ge","!stackunderflow");

rpnOperators.get = function(context) {
    const [b, a] = context.pop("number,name", "array,string,dictionary");
    if (!a) return context;
    if (a.type == "dictionary") {


;

       if (b.type == "name") {
           const elem = a.value[b.value];
           if (!elem) return context.error("undefined");
           if (elem.reference) elem.reference.inc();
           context.stack.push(elem);
           return context;
       } else {
         return context.error("typeerror");
       }
    }
    if (b.value < 0) return context.error("rangerror");
    if (!a.value )return context.error("rangerror");
    if (b.value >= a.value.length) return context.error("rangerror");
    if (a.type == "array") {
       const elem = a.value[b.value];
       if (elem.reference) elem.reference.inc();
       context.stack.push(elem);
    } else {
       context.stack.push(new rpnNumber(a.value.charCodeAt(b.value)));
    }
    a.reference.dec();

    return context;
};
rpnUnitTest("/foo 1 def currentdict /foo get", "1");
rpnUnitTest("/foo 1 def 1 dict /foo get", "!undefined");
rpnUnitTest("(abc) 1 get","98");rpnUnitTest("[1 2 3] 1 get","2");rpnUnitTest("() 1 get","!rangerror");
rpnUnitTest("[] 1 get","!rangerror");rpnUnitTest("(abc) -2 get","!rangerror");rpnUnitTest("[1 2 3] -2 get","!rangerror");
rpnUnitTest("(abc) 3 get","!rangerror");rpnUnitTest("[1 2 3] 3 get","!rangerror");
rpnUnitTest("1 2 get","!typeerror");
rpnUnitTest("(a) get","(a) !stackunderflow");
rpnUnitTest("get","!stackunderflow");
rpnUnitTest("/tri { 3 add } def 2 currentdict /tri get exec ","5");

rpnOperators.getinterval = function(context) {
    const [c, b, a] = context.pop("number", "number", "array,string");
    if (!a) return context;
    if (b.value < 0) return context.error("rangerror");
    if (c.value < 0) return context.error("rangerror");
    if (b.value + c.value > a.value.length) return context.error("rangerror");
    if (a.type == "array") {
       const elem = new rpnArray(a.value.slice(b.value, b.value + c.value), context.heap);
       elem.reference.inc();
       context.stack.push(elem);
    } else {
      const s = new rpnString(a.value.substr(b.value, c.value), context.heap);
      s.reference.inc();
      context.stack.push(s);
    }
    a.reference.dec();
    return context;
};
rpnUnitTest("(abc) 1 2 getinterval","(bc)");
rpnUnitTest("[1 2 3] 1 2 getinterval","[2 3]");
rpnUnitTest("(abc) 1 0 getinterval","()");
rpnUnitTest("[1 2 3] 1 0 getinterval","[]");
rpnUnitTest("() 1 2 getinterval","!rangerror");
rpnUnitTest("[] 1 2 getinterval","!rangerror");
rpnUnitTest("(abc) -2 2 getinterval","!rangerror");
rpnUnitTest("[1 2 3] -2 2 getinterval","!rangerror");
rpnUnitTest("(abc) 3 2 getinterval ","!rangerror");
rpnUnitTest("[1 2 3] 3 2 getinterval","!rangerror");
rpnUnitTest("1 2 2 getinterval","!typeerror");rpnUnitTest("(a) 2 getinterval","(a) 2 !stackunderflow");
rpnUnitTest("(a) getinterval","(a) !stackunderflow");
rpnUnitTest("getinterval","!stackunderflow");

rpnOperators.grestore = function(context) {
    if (!context.graphicsstack.length) {
        context.error("dictstackunderflow");
        return context;
    } else if (context.graphicsstack.length == 1) {
        context.graphics = rpnObjectSlice(context.graphicsstack[0]);
    } else {
        context.graphics = context.graphicsstack.pop();
    }
    return context;
};

rpnOperators.gsave = function(context) {
    context.graphicsstack.push(rpnObjectSlice(context.graphicsstack[context.graphicsstack.length - 1]));
    return context;
};


rpnOperators.gt = function(context) {
    const [b, a] = context.pop("number,string", "number,string");
    if (!b) return context;
    if (a.type != b.type) {
       return context.error("typeerror");
    }
    context.stack.push(new rpnNumber(a.value > b.value ? 1 : 0));
    return context;
};
rpnUnitTest("2 2 gt","0");
rpnUnitTest("2 3 gt","0");
rpnUnitTest("2 0 gt","1");
rpnUnitTest("2 -1 gt","1");
rpnUnitTest("2 (a) gt","!typeerror");
rpnUnitTest("(a) 2 gt","!typeerror");
rpnUnitTest("2 gt","2 !stackunderflow");
rpnUnitTest("gt","!stackunderflow");

rpnOperators.idiv = function(context) {
    const [b, a] = context.pop("number", "number");
    if (!b) return context;
    context.stack.push(new rpnNumber(Math.trunc(a.value / b.value)));
    return context;
};
rpnUnitTest("3 2 idiv","1");
rpnUnitTest("2 0 idiv","Infinity");
rpnUnitTest("3 -2 idiv","-1");
rpnUnitTest("2 (a) idiv","2 !typeerror");
rpnUnitTest("(a) 2 idiv","!typeerror");
rpnUnitTest("2 idiv","2 !stackunderflow");
rpnUnitTest("idiv","!stackunderflow");

rpnOperators.if = function(context) {
    const [doif, condition] = context.pop("any", "number");
    if (!doif) return context;
    if (condition.value) {
       context = rpn(doif.value, context);
    }
    return context;
};
rpnUnitTest("false { 2 3 add } if","");
rpnUnitTest("(a) { 2 3 add } if","!typeerror");
rpnUnitTest("if","!stackunderflow");

rpnOperators.ifelse = function(context) {
    const [doelse, doif, condition] = context.pop("any", "any",  "number");
    if (!doelse) return context;
    if (condition.value) {
       context = rpn(doif.value, context);
    } else {
       context = rpn(doelse.value, context);
    }
    return context;
}
rpnUnitTest("(a) { 2 3 add } { 2 3 sub } ifelse","!typeerror");
rpnUnitTest("ifelse","!stackunderflow");


rpnOperators.index = function(context) {
    const [i] = context.pop("number");
    if (!i) return context;
    if (i.value < 0) {
        context.error("limitcheck");
        return context;
    }
    if (i.value >= context.stack.length) {
        context.error("limitcheck");
        return context;
    }
    const v = context.stack[context.stack.length - i.value - 1];
    if (v.type == "array") v.reference.inc();
    if (v.type == "string") v.reference.inc();
    context.stack.push(v);
    return context;
};
rpnUnitTest("3 4 5 0 index","3 4 5 5");
rpnUnitTest("3 4 5 2 index","3 4 5 3");
rpnUnitTest("3 4 5 3 index","3 4 5 !limitcheck");
rpnUnitTest("3 4 5 -1 index","3 4 5 !limitcheck");
rpnUnitTest("index","!stackunderflow");

rpnOperators.initgraphics = function(context) {
    context.initgraphics();
    return context
};

rpnOperators.itransform = function(context) {
    const [y, x] = context.pop("number","number");
    if (!x) return context;
    const [x2, y2]  = context.itransform(x.value,y.value);
    context.stack.push(new rpnNumber(x2));
    context.stack.push(new rpnNumber(y2));
    return context;
};
rpnUnitTest("50 100 itransform","50 100");
rpnUnitTest("(a) 100 itransform","!typeerror");
rpnUnitTest("50 itransform","50 !stackunderflow");

rpnOperators.known = function(context) {
    const [b, a] = context.pop("name", "dictionary");
    if (!b) return context;
    const elem = a.value[b.value];
    if (elem) {
        context.stack.push(new rpnNumber(1));
    } else {
       context.stack.push(new rpnNumber(0));
    }
    return context;
};
rpnUnitTest("/foo 1 def currentdict /foo known", "1");
rpnUnitTest("/foo 1 def 1 dict /foo known", "0");

rpnOperators.le = function(context) {
    const [b, a] = context.pop("number,string", "number,string");
    if (!b) return context;
    if (a.type != b.type) {
       return context.error("typeerror");
    }
    context.stack.push(new rpnNumber(a.value <= b.value ? 1 : 0));
    return context;
};
rpnUnitTest("2 2 le","1");
rpnUnitTest("2 3 le","1");
rpnUnitTest("2 0 le","0");
rpnUnitTest("2 -1 le","0");
rpnUnitTest("2 (a) le","!typeerror");
rpnUnitTest("(a) 2 le","!typeerror");
rpnUnitTest("2 le","2 !stackunderflow");
rpnUnitTest("le","!stackunderflow");

rpnOperators.length = function(context) {
    const [a] = context.pop("array,string");
    if (!a) return context;
    context.stack.push(new rpnNumber(a.value.length));
    a.reference.dec();
    return context;
};
rpnUnitTest("(abc) length","3");
rpnUnitTest("[1 2 3] length","3");
rpnUnitTest("() length","0");
rpnUnitTest("[] length","0");
rpnUnitTest("1 length","!typeerror");
rpnUnitTest("length","!stackunderflow");

rpnOperators.lineto = function(context) {
    const [y, x] = context.pop("number","number");
    if (!y) return context;
    if (!context.graphics.current.length) {
       context.stack.push(new rpnError("nocurrentpoint"));
    } else if (!context.graphics.path.length) {
       context.stack.push(new rpnError("nocurrentpath"));
    } else {
      const subpath = context.graphics.path.pop();
      const [xt, yt] = context.transform(x.value, y.value);
      subpath.push([ "L", context.graphics.current[0], context.graphics.current[1], xt, yt]);
      context.graphics.path.push(subpath); 
      context.graphics.current = [ xt, yt ];
    }
    return context;
};
rpnUnitTest("50 50 lineto","!nocurrentpoint");
rpnUnitTest("(a) 1 lineto","!typeerror");
rpnUnitTest("1 lineto","1 !stackunderflow");
rpnUnitTest("lineto","!stackunderflow");

rpnOperators.loop = function(context) {
    const [doit] = context.pop("any");
    if (!doit) return context;
    while (true) {
      context = rpn(doit.value, context);
       if (context.lasterror == "exit") {
           context.lasterror = "";
           context.stack.pop();
           return context;
       }
       if (context.lasterror) {
           return context;
       }
    }
};
rpnOperators.lt = function(context) {
    const [b, a] = context.pop("number,string", "number,string");
    if (!b) return context;
    if (a.type != b.type) {
       return context.error("typeerror");
    }
    context.stack.push(new rpnNumber(a.value < b.value ? 1 : 0));
    return context;
};rpnUnitTest("2 2 lt","0");
rpnUnitTest("2 3 lt","1");
rpnUnitTest("2 0 lt","0");
rpnUnitTest("2 -1 lt","0");
rpnUnitTest("2 (a) lt","!typeerror");
rpnUnitTest("(a) 2 lt","!typeerror");
rpnUnitTest("2 lt","2 !stackunderflow");
rpnUnitTest("lt","!stackunderflow");

rpnOperators.max = function(context) {
    const [b, a] = context.pop("number", "number");
    if (!b) return context;
    context.stack.push(new rpnNumber(Math.max(a.value,b.value)));
    return context;
};

rpnOperators.min = function(context) {
    const [b, a] = context.pop("number", "number");
    if (!b) return context;
    context.stack.push(new rpnNumber(Math.min(a.value,b.value)));
    return context;
};

rpnOperators.mod = function(context) {
    const [b, a] = context.pop("number", "number");
    if (!b) return context;
    context.stack.push(new rpnNumber(a.value % b.value));
    return context;
};
rpnUnitTest("3 2 mod","1");
rpnUnitTest("2 0 mod","NaN");
rpnUnitTest("3 -2 mod","1");
rpnUnitTest("2 (a) mod","2 !typeerror");
rpnUnitTest("(a) 2 mod","!typeerror");
rpnUnitTest("2 mod","2 !stackunderflow");
rpnUnitTest("mod","!stackunderflow");

rpnOperators.moveto = function(context) {
    const [y, x] = context.pop("number","number");
    if (!y) return context;
    
    context.graphics.path.push([]);
    const [xt, yt] = context.transform(x.value, y.value);
    context.graphics.current = [ xt, yt ];
    return context;
};
rpnUnitTest("100 50 moveto","");
rpnUnitTest("100 50 moveto currentpoint","100 50");
rpnUnitTest("(a) 1 moveto","!typeerror");rpnUnitTest("1 moveto","1 !stackunderflow");rpnUnitTest("moveto","!stackunderflow");
rpnUnitTest("100 50 moveto 50 150 lineto closepath",'');
rpnUnitTest("100 50 moveto 50 150 lineto closepath currentpoint","100 50");
rpnUnitTest("100 50 moveto 100 90 50 90 50 50 curveto",'');
rpnUnitTest("100 50 moveto 100 90 50 90 50 50 curveto currentpoint","50 50");
rpnUnitTest("100 50 moveto 50 50 lineto",'');
rpnUnitTest("100 50 moveto 50 50 lineto currentpoint","50 50");


rpnOperators.mul = function(context) {
    const [b, a] = context.pop("number", "number");
    if (!b) return context;
    context.stack.push(new rpnNumber(a.value * b.value));
    return context;
};
rpnUnitTest("2 3 mul","6");
rpnUnitTest("2 0 mul","0");
rpnUnitTest("2 -3 mul","-6");
rpnUnitTest("2 (a) mul","2 !typeerror");
rpnUnitTest("(a) 2 mul","!typeerror");
rpnUnitTest("2 mul","2 !stackunderflow");
rpnUnitTest("mul","!stackunderflow");

rpnOperators.ne = function(context) {
    const [b, a] = context.pop("number,string", "number,string");
    if (!b) return context;
    if (a.type != b.type) {
       return context.error("typeerror");
    }
    context.stack.push(new rpnNumber(a.value != b.value ? 1 : 0));
    return context;
};
rpnUnitTest("2 2 ne","0");
rpnUnitTest("2 3 ne","1");
rpnUnitTest("2 0 ne","1");
rpnUnitTest("2 -1 ne","1");
rpnUnitTest("2 (a) ne","!typeerror");
rpnUnitTest("(a) 2 ne","!typeerror");
rpnUnitTest("2 ne","2 !stackunderflow");
rpnUnitTest("ne","!stackunderflow");

rpnOperators.neg = function(context) {
    const [x] = context.pop("number");
    if (!x) return context;
    context.stack.push(new rpnNumber(-x.value));
    return context;
};
rpnUnitTest("2 neg", "-2");
rpnUnitTest("-2 neg", "2");
rpnUnitTest("0 neg", "0");

rpnOperators.newpath = function(context) {
    context.graphics.path = [];
    context.graphics.current = [];
    return context;
}

rpnOperators.not = function(context) {
    const [a] = context.pop("number");
    if (!a) return context;
    context.stack.push(new rpnNumber(a.value ? 0 : 1));
    return context;
};
rpnUnitTest("false not","1");
rpnUnitTest("1 not","0");
rpnUnitTest("0 not","1");
rpnUnitTest("(a) not","!typeerror");
rpnUnitTest("not","!stackunderflow");

rpnOperators.or = function(context) {
    const [b, a] = context.pop("number", "number");
    if (!b) return context;
    var result = 0;
    if (a.value) result = 1;
    if (b.value) result = 1;
    context.stack.push(new rpnNumber(result));
    return context;
};
rpnUnitTest("2 2 or","1");
rpnUnitTest("2 0 or","1");
rpnUnitTest("2 -1 or","1");
rpnUnitTest("2 (a) or","2 !typeerror");
rpnUnitTest("(a) 2 or","!typeerror");
rpnUnitTest("2 or","2 !stackunderflow");
rpnUnitTest("or","!stackunderflow");

rpnOperators.pop = function(context) {
    const [a] = context.pop("any");
    if (!a) return context;
    if (a.type == "array") a.reference.dec();
    if (a.type == "string") a.reference.dec();
    return context;
};
rpnUnitTest("1 2 pop","1");
rpnUnitTest("(a) pop","");
rpnUnitTest("[2 3] pop","");
rpnUnitTest("pop","!stackunderflow");
rpnUnitTest("(a) dup /b exch def pop b", "(a)");

rpnOperators.put = function(context) {
    const [c, b, a] = context.pop("any", "number", "array,string");
    if (!a) return context;
    if (b.value < 0) return context.error("rangerror");
    if (b.value >= a.value.length) return context.error("rangerror");
    if (a.type == "array") {
       const ch = [ c ];
       const s = a.value.slice(0, b.value).concat(ch).concat(a.value.slice(b.value + 1, a.value.length));
       a.replace(s);
    } else {
       const ch = String.fromCharCode(c.value);
       const s = a.value.slice(0, b.value) + ch + a.value.slice(b.value + 1, a.value.length);
       a.replace(s);
    }
   // a.reference.inc();
    return context;
};

rpnOperators.putinterval = function(context) {
    const [c, b, a] = context.pop("string,array", "number", "array,string");
    if (!a) return context;
    if (b.value < 0) return context.error("rangerror");
    if (b.value + c.value.length > a.value.length) return context.error("rangerror");
    if (a.type !== c.type) return context.error("rangerror");
    if (a.type == "array") {
       const s = a.value.slice(0, b.value).concat(c.value).concat(a.value.slice(b.value + c.value.length, a.value.length));
       a.replace(s);
    } else {
       const s = a.value.slice(0, b.value) + c.value + a.value.slice(b.value + c.value.length , a.value.length);
       a.replace(s);
    }
    a.reference.dec();
    c.reference.dec();
    return context;
};

rpnUnitTest("/a (abc) def a 1 (ab) putinterval a","(aab)");
rpnUnitTest("/a [1 2 3] def a 1 [1 2] putinterval a", "[1 1 2]");
rpnUnitTest("() 1 (a) putinterval","!rangerror");
rpnUnitTest("[] 1 [2] putinterval","!rangerror");
rpnUnitTest("(abc) -2 (a) putinterval","!rangerror");
rpnUnitTest("[1 2 3] -2 [1 2] putinterval","!rangerror");
rpnUnitTest("(abc) 3 (a) putinterval","!rangerror");
rpnUnitTest("[1 2 3] 3 [1 2] putinterval","!rangerror");
rpnUnitTest("1 2 2 putinterval","1 2 !typeerror");
rpnUnitTest("(a) 2 putinterval","(a) 2 !stackunderflow");
rpnUnitTest("(a) putinterval","(a) !stackunderflow");
rpnUnitTest("putinterval","!stackunderflow");

rpnOperators.qcurveto = function(context) {
    const [y3, x3, yq, xq] = context.pop("number","number","number","number");
    if (!y3) return context;
    if (!context.graphics.current.length) {
       context.error("nocurrentpoint");
    } else if (!context.graphics.path.length) {
       context.error("nocurrentpath");
    } else {
      const subpath = context.graphics.path.pop();
      const [xqt, yqt] = context.transform(xq.value, yq.value);
      const [x3t, y3t] = context.transform(x3.value, y3.value);
      const [x0t, y0t] = context.graphics.current;
      const [x1t, y1t] = [x0t + 2/3*(xqt-x0t), y0t + 2/3*(yqt-y0t)];
      const [x2t, y2t] = [x3t + 2/3*(xqt-x3t), y3t + 2/3*(yqt-y3t)];
      subpath.push([ "C", x0t, y0t, x1t, y1t, x2t, y2t, x3t, y3t ]);
      context.graphics.path.push(subpath);
      context.graphics.current = [ x3t, y3t ];
    }
    return context;
};

rpnOperators.rand = function(context) {
	// range 0 - 2 exp 31, divide by 2147483648 to get range 0-1
	context.stack.push(new rpnNumber(Math.random()*2147483648));
	return context;
}

rpnOperators.rcurveto = function(context) {
    const [y3, x3, y2, x2, y1, x1] = context.pop("number","number","number","number","number","number");
    if (!y3) return context;
    if (!context.graphics.current.length) {
       context.stack.push(new rpnError("nocurrentpoint"));
    } else if (!context.graphics.path.length) {
       context.stack.push(new rpnError("nocurrentpath"));
    } else {
       const subpath = context.graphics.path.pop();
       const [xct, yct] = context.itransform(context.graphics.current[0], context.graphics.current[1]);
       const [x1t, y1t] = context.transform(xct + x1.value, yct + y1.value);
       const [x2t, y2t] = context.transform(xct + x2.value, yct + y2.value);
       const [x3t, y3t] = context.transform(xct + x3.value, yct + y3.value);
       subpath.push([ "C", context.graphics.current[0], context.graphics.current[1], x1t, y1t, x2t, y2t, x3t, y3t]);
       context.graphics.path.push(subpath);
       context.graphics.current = [ x3t, y3t ];
;

    }
    return context;
};
rpnUnitTest("100 50 moveto 100 90 50 90 50 50 rcurveto",'');
rpnUnitTest("100 50 moveto 100 90 50 90 50 50 rcurveto currentpoint","150 100");
rpnUnitTest("100 90 50 90 50 50 rcurveto","!nocurrentpoint");
rpnUnitTest("(a) 100 90 50 90 50 rcurveto","!typeerror");
rpnUnitTest("100 90 50 90 50 rcurveto","100 90 50 90 50 !stackunderflow");

rpnOperators.readonly = function(context) {
    // makes a dictionary entry readonly. We ignore that operator for the moment
    return context;};
    
rpnOperators.repeat = function(context) {
    const [doit, n] = context.pop("any", "number");
    if (!doit) return context;
    while (n.value > 0) {
       context = rpn(doit.value, context);
       n.value-- ;
    }
    return context;
};
rpnUnitTest("3 2 { 4 add } repeat","11");
rpnUnitTest("3 0 { 4 add } repeat","3");
rpnUnitTest("3 -1 { 4 add } repeat","3");

rpnOperators.rlineto = function(context) {
    const [y, x] = context.pop("number","number");
    if (!y) return context;
    if (!context.graphics.current.length) {
       context.stack.push(new rpnError("nocurrentpoint"));
    } else if (!context.graphics.path.length) {
       context.stack.push(new rpnError("nocurrentpath"));
    } else {
       const subpath = context.graphics.path.pop();
       const [xct, yct] = context.itransform(context.graphics.current[0], context.graphics.current[1]);
       const [xt, yt] = context.transform(xct + x.value, yct + y.value);
       subpath.push([ "L", context.graphics.current[0], context.graphics.current[1], xt, yt ]);
       context.graphics.path.push(subpath);
       context.graphics.current = [ xt, yt];
    }
    return context;
};
rpnUnitTest("100 50 moveto 50 50 rlineto",'');
rpnUnitTest("100 50 moveto 50 50 rlineto currentpoint","150 100");
rpnUnitTest("50 50 rlineto","!nocurrentpoint");
rpnUnitTest("(a) 1 rlineto","!typeerror");
rpnUnitTest("1 rlineto","1 !stackunderflow");
rpnUnitTest("rlineto","!stackunderflow");

rpnOperators.rmoveto = function(context) {
    const [y, x] = context.pop("number","number");
    if (!y) return context;
    if (!context.graphics.current.length) {
       context.stack.push(new rpnError("nocurrentpoint"));
    } else {
      context.graphics.path.push([]);
      const [xct, yct] = context.itransform(context.graphics.current[0], context.graphics.current[1]);
      const [xt, yt] = context.transform(xct + x.value, yct + y.value);
      context.graphics.current = [ xt, yt ];
    }

    return context;
};
rpnUnitTest("100 50 moveto 50 50 rmoveto","");
rpnUnitTest("100 50 moveto 50 50 rmoveto currentpoint","150 100");
rpnUnitTest("50 50 rmoveto","!nocurrentpoint");
rpnUnitTest("(a) 1 rmoveto","!typeerror");
rpnUnitTest("1 rmoveto","1 !stackunderflow");
rpnUnitTest("rmoveto","!stackunderflow");

rpnOperators.roll = function(context) {
    const [roll, n] = context.pop("number", "number");
    if (context.stack.length < n.value) {
        return context.error("stackunderflow");
    }
    const thisstack = context.stack.slice(context.stack.length - n.value);
    const rootstack = context.stack.slice(0,context.stack.length-n.value);
        if (roll.value > 0) {
        for (let i = 0; i < roll.value; i++) {
        thisstack.unshift(thisstack.pop());
    }
    }
    if (roll.value < 0) {
        for (let i = 0; i< -roll.value; i++) {
            thisstack.push(thisstack.shift());
    }
    }
        for (let i = 0; i < n.value; i++) context.stack.pop();
    for (let i = 0; i < n.value; i++) context.stack.push(thisstack.shift());
    return context;
};
rpnUnitTest("1 2 3 4 3 1 roll", "1 4 2 3");
rpnUnitTest("1 2 3 4 3 -1 roll", "1 3 4 2");

rpnOperators.rotate = function(context) {
    const [a] = context.pop("number");
    if (!a) return context;
    const v = a.value * 3.1415326536 / 180 * -1;
    const m = context.graphics.matrix.slice();
    context.graphics.matrix[0] = Math.cos(v)*m[0] - Math.sin(v)*m[2];
    context.graphics.matrix[1] = Math.cos(v)*m[1] - Math.sin(v)*m[3];
    context.graphics.matrix[2] = Math.sin(v)*m[0] + Math.cos(v)*m[2];
    context.graphics.matrix[3] = Math.sin(v)*m[1] + Math.cos(v)*m[3];
    return context;
};

rpnUnitTest("60 rotate currentmatrix","[0.50001732 0.866015404 -0.866015404 0.50001732 0 0]");
rpnUnitTest("(a) rotate currentmatrix","!typeerror");
rpnUnitTest("rotate currentmatrix","!stackunderflow");


rpnOperators.round = function(context) {
    const [r] = context.pop("number");
    if (!r) return context;
    context.stack.push(new rpnNumber(Math.round(r.value)));
    return context;
};

rpnUnitTest("1.6 round","2");
rpnUnitTest("1.4 round","1");
rpnUnitTest("1 round","1");
rpnUnitTest("-1.4 round","-1");
rpnUnitTest("(a) round","!typeerror");
rpnUnitTest("round","!stackunderflow");
rpnUnitTest("100 0 atan round","90");
rpnUnitTest("0 100 atan round","0");
rpnUnitTest("0 -100 atan round","180");
rpnUnitTest("100 100 atan round","45");
rpnUnitTest("0 0 atan round","0");


rpnOperators.run = function(context) {
    const [filename] = context.pop("string");
    if (!filename) return context;
    const s = rpnFiles[filename.value];
    if (!s) return context.error("missingfile");
    context = rpn(s, context);
    return context;
};

rpnOperators.scale = function(context) {
    const [y, x] = context.pop("number","number");
    if (!x) return context;
    context.graphics.matrix[0] *= x.value;
    context.graphics.matrix[1] *= y.value;
    context.graphics.matrix[2] *= x.value;
    context.graphics.matrix[3] *= y.value;
    return context;
};

rpnUnitTest("2 2 scale currentmatrix","[2 0 0 2 0 0]");
rpnUnitTest("2 (a) scale currentmatrix","2 !typeerror");
rpnUnitTest("2 scale currentmatrix","2 !stackunderflow");

rpnOperators.scalefont = function(context) {
    const [scale, font] = context.pop("number","dictionary");
    if (!font) return context;
    context.graphics.size = scale.value;
    context.stack.push(font);
    return context;
};

rpnOperators.search = function(context) {
    const [seek, source] = context.pop("string", "string");
    if (!seek) return context;
    const f = source.value;
    const s = seek.value;
    const n = f.indexOf(s);
    if (n == -1) {
         context.stack.push(source);
         source.reference.inc();
         context.stack.push(new rpnNumber(0));
         return context;
    }
    context.stack.push(new rpnString(f.substring(n+s.length), context.heap));
    context.stack.push(seek);
    seek.reference.inc();
    context.stack.push(new rpnString(f.substring(0,n), context.heap));
    context.stack.push(new rpnNumber(1));
    return context;
};

rpnOperators.setalpha = function(context) {
    const [a] = context.pop("number");
    if (!a) return context;
    const alimited = Math.min(Math.max(a.value,0),1);
    context.graphics.color[3] = Math.round(alimited * 255);
    return context;
};

rpnOperators.setcachedevice = function(context) {
    const [ury, urx, lly, llx, wy, wx] = context.pop("number","number","number","number","number","number");
    const cd = [wx.value, wy.value, llx.value, lly.value, urx.value, ury.value ];
    context.graphics.cachedevice = cd;
    return context;
};

rpnOperators.setfont = function(context) {
    const [font] = context.pop("dictionary");
    context.graphics.font =  font.value.FontName.value;
    return context;
};

rpnOperators.setgray = function(context) {
    const [g] = context.pop("number");
    if (!g) return context;
    const glimited = Math.min(Math.max(g.value,0),1);
    
    context.graphics.color[0] =  Math.round(glimited * 255);
    context.graphics.color[1] =  Math.round(glimited * 255);
    context.graphics.color[2] =  Math.round(glimited * 255);

    return context;
};
rpnUnitTest("0 setgray","");
rpnUnitTest("1 setgray","");
rpnUnitTest("-1 setgray","");
rpnUnitTest("3 setgray","");
rpnUnitTest("(ab) setgray","!typeerror");
rpnUnitTest("setgray","!stackunderflow");
rpnUnitTest("0 setgray currentgray","0");
rpnUnitTest("1 setgray currentgray","1");
rpnUnitTest("-1 setgray currentgray","0");


rpnOperators.setlinewidth = function(context) {
    const [w] = context.pop("number");
    if (!w) return context;
    const wlimited = Math.max(w.value,0);
    context.graphics.linewidth = wlimited ;
    return context;
};
rpnUnitTest("0 setlinewidth","");
rpnUnitTest("1 setlinewidth","");
rpnUnitTest("-1 setlinewidth","");
rpnUnitTest("(ab) setlinewidth","!typeerror");
rpnUnitTest("setlinewidth","!stackunderflow");
rpnUnitTest("0 setlinewidth currentlinewidth","0");
rpnUnitTest("1 setlinewidth currentlinewidth","1");
rpnUnitTest("-1 setlinewidth currentlinewidth","0");


rpnOperators.setmatrix = function(context) {
    const [m] = context.pop("array");
    if (!m) return context;
    if (m.value.length != 6) {
        return context.error("typeerror");
    }
    for (let i = 0; i < 6; i++) {
        context.graphics.matrix[i] = m.value[i].value;
    }
    return context;
};

rpnUnitTest("[1 2 3 4 5 6] setmatrix currentmatrix","[1 2 3 4 5 6]");

rpnOperators.setpagedevice = function(context) {
    const [d] = context.pop("dictionary");
    if (!d) return context;
    const dict = d.value;
    if (dict.canvas)  context.device.canvas = dict.canvas.value;
    if (dict.canvasurl) context.device.canvasurl = dict.canvasurl.value;
    if (dict.color)  context.device.color = dict.color.value;
    if (dict.console)  context.device.console = dict.console.value;
    if (dict.height) context.height = dict.height.value;
    if (dict.oversampling) {
        const oversampling = Math.min(16,Math.max(1, dict.oversampling.value));
        context.device.oversampling = oversampling;
    }
    if (dict.interval) context.device.interval = dict.interval.value;
    if (dict.pdf) context.device.pdf = dict.pdf.value;
    if (dict.pdfurl) context.device.pdfurl = dict.pdfurl.value;
    if (dict.raw)  context.device.raw = dict.raw.value;
    if (dict.rawurl) context.device.rawurl = dict.rawurl.value;
    if (dict.svg) context.device.svg = dict.svg.value;
    if (dict.svgurl) context.device.svgurl = dict.svgurl.value;
    if (dict.textmode) context.device.textmode = dict.textmode.value;
    if (dict.transparent) context.device.transparent = dict.transparent.value;
    if (dict.width) context.width = dict.width.value;
    if (dict.height + dict.oversampling + dict.width + dict.transparent) {
        for (let n of context.nodes) n.clear(context.width, context.height, context.device.oversampling, context.device.transparent);
    }
    
    return context;
};

rpnOperators.setrgbcolor = function(context) {
    const [b, g, r] = context.pop("number", "number", "number");
    if (!g) return context;
    
    const rlimited = Math.min(Math.max(r.value,0),1);
    const glimited = Math.min(Math.max(g.value,0),1);
    const blimited = Math.min(Math.max(b.value,0),1);
    
    context.graphics.color[0] =  Math.round(rlimited * 255);
    context.graphics.color[1] =  Math.round(glimited * 255);
    context.graphics.color[2] =  Math.round(blimited * 255);

    return context;
};


rpnOperators.show = function(context) {
    const [s] = context.pop("string");
    if (!context.graphics.current.length) {
       context.error("nocurrentpoint");
    }
    if (!context.graphics.font) {
       context.error("nocurrentfont");
    }
    if (context.device.textmode) {
        for (let n of context.nodes) {
           if (n.canshow) context = n.show(s.value, context);
        }
    }
    if (!s) return context;
    const font = rpnFonts[context.graphics.font];
    const scale = context.graphics.size / font.head.unitsPerEm;
    var ps = " currentpoint currentpoint translate currentmatrix " + scale + " " + scale + " scale ";
    for (let i = 0; i < s.value.length; i++) {
        const c = s.value.charCodeAt(i);
        const gi = font.glyphIndex(c);
        ps += font.glyphPath(gi);
        ps += " fill ";
        ps += font.glyphWidth(gi) + " 0 translate ";
    }
    ps += " 0 0 moveto setmatrix neg exch neg exch translate ";
    context.showmode = true;
    context = rpn(ps, context);
    context.showmode = false;
    return context;
};

rpnOperators.showpage = function(context) {
    for (let n of context.nodes) context = n.showpage(context);
    context.refresh();
    context.initgraphics();
    return context;
};

rpnOperators.sin = function(context) {
    const [a] = context.pop("number");
    if (!a) return context;
    context.stack.push(new rpnNumber(Math.sin(a.value * 3.1415926536 / 180)));
    return context;
};
rpnUnitTest("30 sin","0.5");
rpnUnitTest("0 sin","0");
rpnUnitTest("-30 sin","-0.5");
rpnUnitTest("(a) sin","!typeerror");
rpnUnitTest("sin","!stackunderflow");

rpnOperators.sqrt = function(context) {
    const [a] = context.pop("number");
    if (!a) return context;
    context.stack.push(new rpnNumber(Math.sqrt(a.value)));
    return context;
};

rpnOperators.string = function(context) {
    const [n] = context.pop("number");
    if (!n) return context;
    if (n.value < 1) {
        context.error("limitcheck");
        return context;
    }
    const s = String.fromCharCode(0).repeat(n.value);
    context.stack.push(new rpnString(s, context.heap));
    return context;
};

rpnOperators.stringwidth = function(context) {
    const [s] = context.pop("string");
    if (!context.graphics.font) {
       context.error("nocurrentfont");
    }
    if (!s) return context;
    const font = rpnFonts[context.graphics.font];
    const scale = context.graphics.size / font.head.unitsPerEm;
    var width = 0;
    for (let i = 0; i < s.value.length; i++) {
        const c = s.value.charCodeAt(i);
        const gi = font.glyphIndex(c);
        width += font.glyphWidth(gi) * scale;
    }
    context.stack.push(new rpnNumber(width));
    context.stack.push(new rpnNumber(0));
    return context;
};

rpnOperators.stroke = function(context) {
    for (let n of context.nodes) context = n.stroke(context);
    context.graphics.path = [];
    context.graphics.current = [];
    return context;};
rpnUnitTest("stroke","");

rpnOperators.sub = function(context) {
    const [b, a] = context.pop("number", "number");
    if (!b) return context;
    context.stack.push(new rpnNumber(a.value - b.value));
    return context;
};
rpnUnitTest("2 3 sub","-1");
rpnUnitTest("2 0 sub","2");
rpnUnitTest("2 -3 sub","5");
rpnUnitTest("2 (a) sub","2 !typeerror");
rpnUnitTest("(a) 2 sub","!typeerror");
rpnUnitTest("2 sub","2 !stackunderflow");
rpnUnitTest("sub","!stackunderflow");
rpnUnitTest("false { 2 3 add } { 2 3 sub } ifelse","-1");

rpnOperators.transform = function(context) {
    const [y, x] = context.pop("number","number");
    if (!x) return context;
    const [x2, y2]  = context.transform(x.value,y.value);
    context.stack.push(new rpnNumber(x2));
    context.stack.push(new rpnNumber(y2));
    return context;
};
rpnUnitTest("50 100 transform","50 100");
rpnUnitTest("(a) 100 transform","!typeerror");
rpnUnitTest("50 transform","50 !stackunderflow");

rpnOperators.translate = function(context) {
    const [y, x] = context.pop("number","number");
    if (!x) return context;
    const m = context.graphics.matrix.slice();
    context.graphics.matrix[4] += x.value*m[0] + y.value*m[2];
    context.graphics.matrix[5] += x.value*m[1] + y.value*m[3];
    return context;
};
rpnUnitTest("2 2 translate 50 100 transform","52 102");
rpnUnitTest("50 100 translate currentmatrix","[1 0 0 1 50 100]");
rpnUnitTest("2 (a) translate currentmatrix","2 !typeerror");
rpnUnitTest("2 translate currentmatrix","2 !stackunderflow");
rpnUnitTest("2 2 translate 52 102 itransform","50 100");


rpnOperators.true = function(context) {
    context.stack.push(new rpnNumber(1));
    return context;
};
rpnUnitTest("true","1");
rpnUnitTest("true { 2 3 add } if","5");
rpnUnitTest("true if","1 !stackunderflow");
rpnUnitTest("true { 2 3 add } { 2 3 sub } ifelse","5");
rpnUnitTest("true { 2 3 add } ifelse","1 { 2 3 add } !stackunderflow");rpnUnitTest("true ifelse","1 !stackunderflow");rpnUnitTest("true not","0");

rpnOperators.widthshow = function(context) {
    const [s, ch, cy, cx ] = context.pop("string", "number", "number", "number");
    if (!context.graphics.current.length) {
       context.error("nocurrentpoint");
    }
    if (!context.graphics.font) {
       context.error("nocurrentfont");
    }
    if (!s) return context;
    const font = rpnFonts[context.graphics.font];
    const scale = context.graphics.size / font.head.unitsPerEm;
    const [cx0, cy0] = [cx.value / scale, cy.value / scale];
    const [currentx0, currenty0] = context.graphics.current;
    var targetwidth = 0;
    var ps = " currentpoint currentpoint translate currentmatrix " + scale + " " + scale + " scale ";
    for (let i = 0; i < s.value.length; i++) {
        const c = s.value.charCodeAt(i);
        const gi = font.glyphIndex(c);
        ps += font.glyphPath(gi);
        ps += " fill ";
        ps += font.glyphWidth(gi) + " 0 translate ";
        targetwidth +=  font.glyphWidth(gi) ;
        if (c == ch.value) {
           ps += cx0 + " " + cy0 + " translate ";
           targetwidth +=  cx0 ;
        }
    }
    ps += " setmatrix neg exch neg exch translate ";   
    context.showmode = true;
    context = rpn(ps, context);
    context.showmode = false;
    
    if (context.device.textmode) {
        targetwidth *= scale;
        context.graphics.current = [currentx0, currenty0];
        for (let n of context.nodes) {
           if (n.canshow) context = n.show(s.value, context, targetwidth, cx.value);
        }
    }
    return context;
};

/* UTILITY FUNCTIONS */

rpnEndOfine = String.fromCharCode(10);
rpnStartTag = String.fromCharCode(60);
rpnEndTag = String.fromCharCode(62);
rpnBackSlash = String.fromCharCode(92);

rpnObjectSlice = function (ob) {
   return JSON.parse(JSON.stringify(ob));
};

rpnHtmlSpecialChars  = function(text) {
  if (!text) {
      return text;
  }
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "'");
};

rpnLimitText = function (s) {
    if ( ! s ) s = this;
    if (s.length < 140) return s;
    const rest = "<div onclick='rpnSwitchDisplay(event.target)' style='text-decoration:underline'>+</div><div style='display:none'>"+s.substring(140,s.length)+"</div>";
    return s.substring(0,140) + rest;
};

rpnLimitTextEnd = function (s) {
    if ( ! s ) s = this;
    if (s.length < 140) return s;
    const rest = "<div onclick='rpnSwitchDisplay(event.target)' style='text-decoration:underline'>+</div><div style='display:none'>"+s.substring(0,s.length-140)+"</div>";
    return rest + s.substr(s.length-140,s.length);
};

readSyncURL = function(url){
   const xhr = new XMLHttpRequest();
   xhr.open("GET", url, false);
   xhr.overrideMimeType("text/plain; charset=x-user-defined"); //Override MIME Type to prevent UTF-8 related errors
   xhr.send();
   URL.revokeObjectURL(url); 
   return xhr.responseText;
};

readSyncDataURL = function(url, filetype = ""){
    // var url=URL.createObjectURL(file);//Create Object URL
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url, false);//Synchronous XMLHttpRequest on Object URL
    xhr.overrideMimeType("text/plain; charset=x-user-defined");//Override MIME Type to prevent UTF-8 related errors
    xhr.send();
    URL.revokeObjectURL(url);
    var returnText = "";
    for (let i = 0; i < xhr.responseText.length; i++) {
       returnText += String.fromCharCode(xhr.responseText.charCodeAt(i) & 0xff) ;
    } //remove higher byte
    return "data:"+filetype+";base64,"+btoa(returnText); //Generate data URL
};

/* POSTSCRIPT EDITOR */

rpnRedirectConsole = function(id) {
    const current = document.getElementById("console"+id);
    if (! current) return;
    console.log = function(s) {
        if (s) {
            current.innerHTML += s + "<br/>";
        }
    };
    console.error = function(message,url,line) {
        const node = document.createElement("SPAN"); 
        node.className = "error";
        node.innerHTML = message || "unknown error";
        current.innerHTML += node.outerHTML + "<br/>";
    };
    window.onerror = function(message,url,line) {
        const node = document.createElement("SPAN");
        node.className = "error";
        node.innerHTML = message || "unknown error";
        current.innerHTML += node.outerHTML+ "<br/>";
    };
    document.getElementById("console"+id).innerHTML = "";
};

rpnSwitchDisplay = function (node) {
    if (node.nextSibling.style.display == "block") {
        node.nextSibling.style.display = "none";
    } else {
        node.nextSibling.style.display = "block";
    }
};

String.prototype.rpnLimitText = rpnLimitText;
String.prototype.rpnLimitTextEnd = rpnLimitTextEnd;

rpnPostScriptEditor = function(code) {
    const id = Math.floor(Math.random() * 1000);  // create unique id for console.log
    const node = document.createElement("DIV");   // build the HTML nodes
    node.id = "id" & id;
    node.className = "psmain";
    const node2 = document.createElement("DIV");
    node2.className = "editzone";
    node.appendChild(node2);
    const node3 = document.createElement("DIV");
    node3.className = "editheader";
    node3.innerHTML = "PostScript";
    node2.appendChild(node3);
    const node4 = document.createElement("FORM");
    node2.appendChild(node4);
    const node5 = document.createElement("BUTTON");
    node5.type = "button";
    node5.id = "button" + id;
    node5.innerHTML = "Run";
    node4.appendChild(node5);
    const node6 = document.createElement("TEXTAREA");
    node6.id = "editor" + id;
    node6.className = "pseditor";
    node6.innerHTML = code;
    node6.rows = code.split(rpnEndOfine).length + 1;
    node4.appendChild(node6);
    const node7 = document.createElement("DIV");
    node7.id = "console" + id;
    node7.className = "jsconsole";   
    const node8 = document.createElement("CANVAS");
    node8.id = "raw" + id;
    node8.className = "jscanvas";
    node8.style.display = "none";
    node8.width = 590;
    node8.height = 330;
    node.appendChild(node8);
    const node9 = document.createElement("A");
    node9.id = "rawurl" + id;
    node9.innerHTML = "PNG raw";
    node9.style.display = "none";
    node.appendChild(node9);
    const node10 = document.createElement("CANVAS");
    node10.id = "canvas" + id;
    node10.className = "jscanvas";
    node10.width = 590;
    node10.height = 330;
    node10.style.display = "none";
    node.appendChild(node10);
    const node11 = document.createElement("A");
    node11.id = "canvasurl" + id;
    node11.innerHTML = "PNG canvas";
    node11.style.display = "none";
    node.appendChild(node11);
    const node12 = document.createElement("SVG");
    node12.id = "svg" + id;
    node12.className = "jssvg";
    node12.setAttribute("width","590px");
    node12.setAttribute("height","330px");
    node12.style.display = "none";
    node.appendChild(node12);
    const node13 = document.createElement("A");
    node13.id = "svgurl" + id;
    node13.innerHTML = "SVG";
    node13.style.display = "none";
    node.appendChild(node13);
    const node14 = document.createElement("IMG");
    node14.id = "pdf" + id;
    node14.style.display = "none";
    node14.style.backgroundColor = "white";
    node14.width = 590;
    node14.height = 330;
    node.appendChild(node14);
    const node15 = document.createElement("A");
    node15.id = "pdfurl" + id;
    node15.innerHTML = "PDF";
    node15.style.display = "none";
    node.appendChild(node15);
    node.appendChild(node7);
    console.log(node.outerHTML);  // add the node to the parent element

    const script = `rpnRedirectConsole($id);
        run$id = function() {
        rpnRedirectConsole($id);
        const width = 590;
        const height = 330;
        const code = document.getElementById("editor$id").value;
        
        var context = new rpnContext;
        context.width = width;
        context.height = height;
        context.nodes.push(new rpnRawDevice(document.getElementById("raw$id"), document.getElementById("rawurl$id")));
        context.nodes.push(new rpnCanvasDevice(document.getElementById("canvas$id"), document.getElementById("canvasurl$id")));
        context.nodes.push(new rpnSVGDevice(document.getElementById("svg$id"), document.getElementById("svgurl$id")));
        context.nodes.push(new rpnPDFDevice(document.getElementById("pdf$id"), document.getElementById("pdfurl$id")));
        context = rpn(code, context, true);
        if (context.device.console) {
            console.log("<b>stack:</b> " + context.stack.reduce((acc,v) => acc + v.dump + " " , " ").rpnLimitTextEnd());
            if (context.lasterror) {
                console.log("<b>rpn:</b> " + context.currentcode.rpnLimitTextEnd());
            } 
            console.log("<b>dict:</b>")
            for (key in context.dict) {
                console.log(key + " = " + (context.dict[key].dump).rpnLimitText());
            } 
            console.log("<b>graphics:</b>")
            for (key in context.graphics) {
                console.log(key + ": " + context.graphics[key]);
            } 
            console.log("<b>fonts:</b>")
            for (key in context.fontdict) {
                console.log(key);
            }
            console.log("<b>device:</b>")
            for (key in context.device) {
                console.log(key + ": " + context.device[key]);
            } 
           if (context.heap.length) {
               console.log("<b>heap:</b> " + context.heap.reduce( function(acc, v) {
	               const val = v.value;
	               if (Array.isArray(val)) {
	                  return acc + "<br>[" + val.reduce( (acc2, v2) => acc2 + v2.dump + " " , " ") + "] "+v.counter+"<br>";
	              } else if (val === null) {
	                  return acc + "<br>";
	              } else {
	                return acc + "<br>(" + val + ") "+v.counter;
	              }
	           }  , "").rpnLimitText());
           }       
      }    
    };
    document.getElementById("button$id").onclick = run$id;
`.replaceAll("$id", id).replaceAll("$code",code);
    const scriptnode = document.createElement("SCRIPT");
    scriptnode.innerHTML = script;
    document.body.appendChild(scriptnode);  // run the script
    
};


/* TRUETYPE FONT */

rpnBinary = class {
   constructor (buffer) {
       this.buffer = buffer;
       this.data = new Uint8Array(buffer.length);
       for (let i = 0; i < buffer.length; i++) {
           this.data[i] = buffer.codePointAt(i);
       }
       this.position = 0;
       this.position = 0;
   }
   getUint8() { return this.data[this.position++]; }
   getUint16() { return this.getUint8() * 256 + this.getUint8(); }
   getUint32() { return this.getUint8() * 256*256*256 + this.getUint8() * 256*256 + this.getUint8() * 256 + this.getUint8(); }
   getInt16() {
       var n = this.getUint16();
       if (n & 0x8000) n -= 1 * 256*256;
       return n;
   }
   getInt32 () { return this.getUint32(); }
   getFWord() { return this.getInt16() ; }
   getUFWord() { return this.getUint16() ; }
   getOffset16() { return this.getUint16() ; }
   getOffset32() { return this.getUint32() ; }
   getF2Dot14() { return this.getInt16() * 1.0 / (256*64) ; }
   getFixed() { return this.getInt32() * 1.0 / (256*256)  ; }
   getString(n) {
       var string = "";
       for (let i = 0; i < n; i++) {
           string += String.fromCharCode(this.getUint8());
       }
       return string;
   }
   getDate() {
       const macTime = this.getUint32() * 0x100000000 + this.getUint32();
       const utcTime = macTime * 1000 + Date.UTC(1904, 1, 1);
       return new Date(utcTime);
   }
   getPosition() { return this.position; }
   setPosition(p) { this.position = p; } 
} ;


rpnTTF = class {
    constructor(path) {
        this.path = path;
        this.error = "";
        const file = readSyncURL(path);
        this.reader = new rpnBinary(file);

        this.reader.getUint32(); // scalarType
        const numTables = this.reader.getUint16();
        this.reader.getUint16();  // searchRange
        this.reader.getUint16();  // entrySelector
        this.reader.getUint16();  // rangeShift

        this.tables = {};
        for (let i = 0; i < numTables; i++) {
             const tag = this.reader.getString(4);
             this.tables[tag] = {
                 checksum: this.reader.getUint32(),
                 offset: this.reader.getUint32(),
                 length: this.reader.getUint32(),
             };
        }       
        this.reader.setPosition(this.tables.head.offset);
        this.head = {
            majorVersion: this.reader.getUint16(),
            minorVersion: this.reader.getUint16(),
            fontRevision: this.reader.getFixed(),
            checksumAdjustment: this.reader.getUint32(),
            magicNumber: this.reader.getUint32(),
            flags: this.reader.getUint16(),
            unitsPerEm: this.reader.getUint16(),
            created: this.reader.getDate(),
            modified: this.reader.getDate(),
            xMin: this.reader.getFWord(),
            yMin: this.reader.getFWord(),
            xMax: this.reader.getFWord(),
            yMax: this.reader.getFWord(),
            macStyle: this.reader.getUint16(),
            lowestRecPPEM: this.reader.getUint16(),
            fontDirectionHint: this.reader.getInt16(),
            indexToLocFormat: this.reader.getInt16(),
            glyphDataFormat: this.reader.getInt16()
        };
        if (this.head.magicNumber != 0x5F0F3CF5) {
            this.error =  "invalid truetype magic";
            return;
        }
        if (!this.tables.maxp) {
            this.error =  "truetype error maxp missing";
            return;
        }
        this.reader.setPosition(this.tables.maxp.offset);
        this.maxp = {
           version: this.reader.getFixed(),
           numGlyphs: this.reader.getUint16(),
           maxPoints: this.reader.getUint16(),
           maxContours: this.reader.getUint16(),
           maxCompositePoints: this.reader.getUint16(),
           maxCompositeContours: this.reader.getUint16(),
           maxZones: this.reader.getUint16(),
           maxTwilightPoints: this.reader.getUint16(),
           maxStorage: this.reader.getUint16(),
           maxFunctionDefs: this.reader.getUint16(),
           maxInstructionDefs: this.reader.getUint16(),
           maxStackElements: this.reader.getUint16(),
           maxSizeOfInstructions: this.reader.getUint16(),
           maxComponentElements: this.reader.getUint16(),
           maxComponentDepth: this.reader.getUint16()
        };
        this.reader.setPosition(this.tables.cmap.offset);
        this.cmap = {
            version: this.reader.getUint16(),
            numTables: this.reader.getUint16(),
            encodingRecords: [],
            glyphIndexMap: {},
        };
        if (this.cmap.version) {
            this.error =  "truetype error camp version not 0";
            return;
        }
        for (let i = 0; i < this.cmap.numTables; i++) {
            this.cmap.encodingRecords.push({
                platformID: this.reader.getUint16(),
                encodingID: this.reader.getUint16(),
                offset: this.reader.getOffset32(),
            });
        }
        // we only support platform 0 and and encoding 3
        var encodingsOffset = -1;
        for (let i = 0; i < this.cmap.encodingRecords.length; i++) {
            const  { platformID, encodingID, offset } =  this.cmap. encodingRecords[i];
            if ( platformID == 0 && encodingID == 3 ) encodingsOffset = offset; // unicode 
            if ( platformID == 3 && encodingID == 1 ) encodingsOffset = offset; // windows
            if (encodingsOffset > -1 ) break;
        }
        if (encodingsOffset == -1 ) {
             this.error = "truetype unsupported encoding";
             return;
        }
        const formatstart = this.tables.cmap.offset + encodingsOffset;
        this.reader.setPosition(formatstart);
        const format = this.reader.getUint16();
        if (format != 4 ) {
            this.error = "truetype unsupported format";
            return;
        }

        this.cmap.format = {
            format: 4,
            length: this.reader.getUint16(),
            language: this.reader.getUint16(),
            segCountX2: this.reader.getUint16(),
            searchRange: this.reader.getUint16(),
            entrySelector: this.reader.getUint16(),
            rangeShift: this.reader.getUint16(),
            endCode: [],
            startCode: [],
            idDelta: [],
            idRangeOffset: [],
            glyphIndexMap: {}, // This one is my addition, contains final unicode->index mapping
        };
        const segCount = this.cmap.format.segCountX2 / 2;
        for (let i = 0; i < segCount; i++) {
            this.cmap.format.endCode.push(this.reader.getUint16());
        }

        this.reader.getUint16(); // Reserved pad.

        for (let i = 0; i < segCount; i++) {
            this.cmap.format.startCode.push(this.reader.getUint16());
        }

        for (let i = 0; i < segCount; i++) {
            this.cmap.format.idDelta.push(this.reader.getInt16());
        }

        for (let i = 0; i < segCount; i++) {
            this.cmap.format.idRangeOffset.push(this.reader.getUint16());
        }
 
        const remaining_bytes =  formatstart + this.cmap.format.length - this.reader.getPosition();
        this.cmap.format.glyphIdArray = [];
        for (let i = 0; i < remaining_bytes / 2; i++) {
            this.cmap.format.glyphIdArray.push(this.reader.getUint16());
        }
         
        this.reader.setPosition(this.tables.hhea.offset);
        this.hhea = {
           version: this.reader.getFixed(),
           ascent: this.reader.getFWord(),
           descent: this.reader.getFWord(),
           lineGap: this.reader.getFWord(),
           advanceWidthMax: this.reader.getUFWord(),
           minLeftSideBearing: this.reader.getFWord(),
           minRightSideBearing: this.reader.getFWord(),
           xMaxExtent: this.reader.getFWord(),
           caretSlopeRise: this.reader.getInt16(),
           caretSlopeRun: this.reader.getInt16(),
           caretOffset: this.reader.getFWord(),
           reserved0: this.reader.getInt16(),
           reserved1: this.reader.getInt16(),
           reserved2: this.reader.getInt16(),
           reserved3: this.reader.getInt16(),
           metricDataFormat: this.reader.getInt16(),
           numOfLongHorMetrics: this.reader.getInt16()
         };
         this.reader.setPosition(this.tables.hmtx.offset);
         const hMetrics = [];
         for (let i = 0; i < this.hhea.numOfLongHorMetrics; i++) {
             hMetrics.push({
                 advanceWidth: this.reader.getUint16(),
                 leftSideBearing: this.reader.getInt16()
             });
         } 
         const leftSideBearing = [];
         for (let i = 0; i < this.maxp.numGlyphs - this.hhea.numOfLongHorMetrics; i++) {
             leftSideBearing.push(this.reader.getFWord());
         }
         this.hmtx = {
             hMetrics,
             leftSideBearing
         };
         this.reader.setPosition(this.tables.loca.offset);
         const loca = [];
         for (let i = 0; i < this.maxp.numGlyphs + 1; i++) {
             if (this.head.indexToLocFormat)
                 loca.push(this.reader.getOffset32());
             else
                 loca.push(this.reader.getOffset16());
         }
         this.glyphs = [];
         
         function readCoords(glyph, name, byteFlag, deltaFlag, numPoints, flags, reader) {
            var value = 0;

            for (let i = 0; i < numPoints; i++) {
                var flag = flags[i];
                if (flag & byteFlag) {
                    if (flag & deltaFlag) {
                        value += reader.getUint8();
                    } else {
                        value -= reader.getUint8();
                    }
                } else if (~flag & deltaFlag) {
                    value += reader.getInt16();
                } else {
                    // value is unchanged.
                }

                glyph.points[i][name] = value
            }
         }
         for (let i = 0; i < loca.length - 1; i++) {
             const length = loca[i+1] - loca[i];
             if (!length) {
                 this.glyphs.push(null);
                 continue;
             }
             const multiplier = this.head.indexToLocFormat === 0 ? 2 : 1;
             const locaOffset = loca[i] * multiplier;
             this.reader.setPosition(this.tables.glyf.offset + locaOffset);
             const glyph = {
                 numberOfContours: this.reader.getInt16(),
                 xMin: this.reader.getInt16(),
                 yMin: this.reader.getInt16(),
                 xMax: this.reader.getInt16(),
                 yMax: this.reader.getInt16()
             };
             if (glyph.numberOfContours >= 0) {
             glyph.endPtsOfContours = [];
             for (let j = 0; j < glyph.numberOfContours; j++) {
                 glyph.endPtsOfContours.push(this.reader.getUint16());
             }
             glyph.instructionLength = this.reader.getUint16();
             glyph.instructions = [];
             for (let j = 0; j < glyph.instructionLength; j++) {
                 glyph.instructions.push(this.reader.getUint8());
             }
             const numPoints = Math.max(...glyph.endPtsOfContours)+1;
             const flags = [];
             glyph.points = [];
             for (let j = 0; j < numPoints; j++) {
                 const flag = this.reader.getUint8();
                 flags.push(flag);
                 glyph.points.push( { x: 0, y: 0, onCurve: flag & 1 });
                 if (flag & 8) {
                     var repeatCount = this.reader.getUint8();
                     j += repeatCount;
                     while (repeatCount--) {
                         flags.push(flag);
                          glyph.points.push( { x: 0, y: 0, onCurve: flag & 1 });  
                     }
                 } 
             }
             // if (glyph.points.length) glyph.points[0].onCurve = 1; WTF

            
            readCoords(glyph, "x", 2, 16, numPoints, flags, this.reader);
            readCoords(glyph, "y", 4, 32, numPoints, flags, this.reader);
 
            
            } else {
	            glyph.components = [];
	            // read composite glyph
	            var flags;
	            do {
	                flags = this.reader.getUint16();
	                const index = this.reader.getUint16();
	                glyph.components.push(index);
	                const argument1 = (flags & 0x0001) ? this.reader.getUint16() : this.reader.getUint8();
	                const argument2 = (flags & 0x0001) ? this.reader.getUint16() : this.reader.getUint8();
	                var scale = 1.0;
	                var xscale = 1.0;
	                var yscale = 1.0;
	                if (flags & 0x0008) {
	                    scale = this.reader.getF2Dot14();
	                } else if (flags & 0x0040) {
	                    xscale = this.reader.getF2Dot14();
	                    yscale = this.reader.getF2Dot14();
	                } else if (flags & 0x0080) {
	                    xscale = this.reader.getF2Dot14();
	                    reader.getF2Dot14();
	                    reader.getF2Dot14();
	                    yscale = this.reader.getF2Dot14();
	                }
	            } while (flags & 0x0020);
            }
            this.glyphs.push(glyph); /* while loop ends with ; */       
          }

    }
    glyphIndex(unicode) {
        for (let i = 0; i < this.cmap.format.segCountX2 / 2 ; i++) {
            if (unicode >= this.cmap.format.startCode[i] && unicode <= this.cmap.format.endCode[i] ) {
                if (this.cmap.format.idRangeOffset[i]) {
                    const idx = this.cmap.format.idRangeOffset[i]/2 + unicode - this.cmap.format.startCode[i] - this.cmap.format.idRangeOffset.length; // offset calculation starts at beginning of idRangeOffset, not glyphIdArray, so we must subtract 2 bytes per value              
                    return this.cmap.format.glyphIdArray[idx] + this.cmap.format.idDelta[i] ;
                } else {
                    return unicode + this.cmap.format.idDelta[i] ;
                }
            }           
        }
        return 0; //missing glyph
    }
    glyphWidth(gi) {
        if (gi < this.hmtx.hMetrics.length) {
            return this.hmtx.hMetrics[gi].advanceWidth;
        } else {
            return this.hmtx.hMetrics[0].advanceWidth; // monospaced font
        }
    }
    glyphPath(gi) {
        const glyph = this.glyphs[gi];
        if (!glyph) return "";
        var ps = "";
        var points = [];
        var endPtsOfContours = [];
        if (glyph.points.length) {
            points = glyph.points;
            endPtsOfContours = glyph.endPtsOfContours;
        } else if (glyph.components.length) {
            for (let j = 0; j < glyph.components.length; j++) {
                const cglyph = this.glyphs[glyph.components[j]];
                points = points.concat(cglyph.points);
                endPtsOfContours = endPtsOfContours.concat(cglyph.points);
            }
        }
        
         if (points.length) {
            
            /* Where quadratic points occur next to each other, an on-curve control point is interpolated between them. And there is another convention, that if a closed path starts with a quadratic point, the last point of the path is examined, and if it is quadratic, an on-curve point is interpolated between them, and the path is taken to start with that on-curve point; if the last point is not a quadratic control point, it is itself used for the start point.
             https://stackoverflow.com/questions/3465809/how-to-interpret-a-freetype-glyph-outline-when-the-first-point-on-the-contour-is
                 */ 
            
            var p;
            var rpnBezier = [];
            var start = true;
            var last = 0;
            var lastp;
            var p0x;
            var p0y;
            for (let j = 0; j <  points.length; j++) {
                
                p = points[j];
                if (start)
                {   
                    if (p.onCurve) {
                        p0x = p.x;
                        p0y = p.y;
                    } else {
                        // find last point
                        for (let k = 0; k < endPtsOfContours.length; k++) {
                            if (endPtsOfContours[k] > j) {
                                last = k;
                                break;
                            }
                            // should not happen
                        }
                        lastp = points[endPtsOfContours[last]];      
                        if (lastp.onCurve) {
                            p0x = lastp.x;
                            p0x = lastp.y;
                        } else {
                            p0x = (p.x + lastp.x) / 2;
                            p0y = (p.y + lastp.y) / 2;
                        } 
                    }
                    ps += p0x + " " + p0y + " moveto ";
                    start = false;
                }
                
                if (p.onCurve) {                    
                   if (rpnBezier.length) {
                       ps += rpnBezier[0] + " " + rpnBezier[1] + " " + p.x + " " + p.y + " qcurveto ";
                       rpnBezier = [];
                   } else
                   ps += p.x + " " + p.y + " lineto ";
                } else {
                  if (rpnBezier.length) {
                      
                      ps += rpnBezier[0] + " " + rpnBezier[1] + " " + (rpnBezier[0] + p.x)/2 + " " + (rpnBezier[1] + p.y)/2 + " qcurveto ";
                  } 
                  rpnBezier = [p.x, p.y];
                } 
                if (endPtsOfContours.includes(j)) {
                    if (rpnBezier.length) {
                        ps += (rpnBezier[0]) + " " + (rpnBezier[1]) +  " " + p0x + " " + p0y + " qcurveto ";
                    }
                    ps += " closepath " ;
                    start = true;
                    rpnBezier = [];
                }      
           }
        } 
        return ps;
    }
    
};

rpnRomanMapping = `0x20    0x0020    # SPACE
0x21    0x0021    # EXCLAMATION MARK
0x22    0x0022    # QUOTATION MARK
0x23    0x0023    # NUMBER SIGN
0x24    0x0024    # DOLLAR SIGN
0x25    0x0025    # PERCENT SIGN
0x26    0x0026    # AMPERSAND
0x27    0x0027    # APOSTROPHE
0x28    0x0028    # LEFT PARENTHESIS
0x29    0x0029    # RIGHT PARENTHESIS
0x2A    0x002A    # ASTERISK
0x2B    0x002B    # PLUS SIGN
0x2C    0x002C    # COMMA
0x2D    0x002D    # HYPHEN-MINUS
0x2E    0x002E    # FULL STOP
0x2F    0x002F    # SOLIDUS
0x30    0x0030    # DIGIT ZERO
0x31    0x0031    # DIGIT ONE
0x32    0x0032    # DIGIT TWO
0x33    0x0033    # DIGIT THREE
0x34    0x0034    # DIGIT FOUR
0x35    0x0035    # DIGIT FIVE
0x36    0x0036    # DIGIT SIX
0x37    0x0037    # DIGIT SEVEN
0x38    0x0038    # DIGIT EIGHT
0x39    0x0039    # DIGIT NINE
0x3A    0x003A    # COLON
0x3B    0x003B    # SEMICOLON
0x3C    0x003C    # LESS-THAN SIGN
0x3D    0x003D    # EQUALS SIGN
0x3E    0x003E    # GREATER-THAN SIGN
0x3F    0x003F    # QUESTION MARK
0x40    0x0040    # COMMERCIAL AT
0x41    0x0041    # LATIN CAPITAL LETTER A
0x42    0x0042    # LATIN CAPITAL LETTER B
0x43    0x0043    # LATIN CAPITAL LETTER C
0x44    0x0044    # LATIN CAPITAL LETTER D
0x45    0x0045    # LATIN CAPITAL LETTER E
0x46    0x0046    # LATIN CAPITAL LETTER F
0x47    0x0047    # LATIN CAPITAL LETTER G
0x48    0x0048    # LATIN CAPITAL LETTER H
0x49    0x0049    # LATIN CAPITAL LETTER I
0x4A    0x004A    # LATIN CAPITAL LETTER J
0x4B    0x004B    # LATIN CAPITAL LETTER K
0x4C    0x004C    # LATIN CAPITAL LETTER L
0x4D    0x004D    # LATIN CAPITAL LETTER M
0x4E    0x004E    # LATIN CAPITAL LETTER N
0x4F    0x004F    # LATIN CAPITAL LETTER O
0x50    0x0050    # LATIN CAPITAL LETTER P
0x51    0x0051    # LATIN CAPITAL LETTER Q
0x52    0x0052    # LATIN CAPITAL LETTER R
0x53    0x0053    # LATIN CAPITAL LETTER S
0x54    0x0054    # LATIN CAPITAL LETTER T
0x55    0x0055    # LATIN CAPITAL LETTER U
0x56    0x0056    # LATIN CAPITAL LETTER V
0x57    0x0057    # LATIN CAPITAL LETTER W
0x58    0x0058    # LATIN CAPITAL LETTER X
0x59    0x0059    # LATIN CAPITAL LETTER Y
0x5A    0x005A    # LATIN CAPITAL LETTER Z
0x5B    0x005B    # LEFT SQUARE BRACKET
0x5C    0x005C    # REVERSE SOLIDUS
0x5D    0x005D    # RIGHT SQUARE BRACKET
0x5E    0x005E    # CIRCUMFLEX ACCENT
0x5F    0x005F    # LOW LINE
0x60    0x0060    # GRAVE ACCENT
0x61    0x0061    # LATIN SMALL LETTER A
0x62    0x0062    # LATIN SMALL LETTER B
0x63    0x0063    # LATIN SMALL LETTER C
0x64    0x0064    # LATIN SMALL LETTER D
0x65    0x0065    # LATIN SMALL LETTER E
0x66    0x0066    # LATIN SMALL LETTER F
0x67    0x0067    # LATIN SMALL LETTER G
0x68    0x0068    # LATIN SMALL LETTER H
0x69    0x0069    # LATIN SMALL LETTER I
0x6A    0x006A    # LATIN SMALL LETTER J
0x6B    0x006B    # LATIN SMALL LETTER K
0x6C    0x006C    # LATIN SMALL LETTER L
0x6D    0x006D    # LATIN SMALL LETTER M
0x6E    0x006E    # LATIN SMALL LETTER N
0x6F    0x006F    # LATIN SMALL LETTER O
0x70    0x0070    # LATIN SMALL LETTER P
0x71    0x0071    # LATIN SMALL LETTER Q
0x72    0x0072    # LATIN SMALL LETTER R
0x73    0x0073    # LATIN SMALL LETTER S
0x74    0x0074    # LATIN SMALL LETTER T
0x75    0x0075    # LATIN SMALL LETTER U
0x76    0x0076    # LATIN SMALL LETTER V
0x77    0x0077    # LATIN SMALL LETTER W
0x78    0x0078    # LATIN SMALL LETTER X
0x79    0x0079    # LATIN SMALL LETTER Y
0x7A    0x007A    # LATIN SMALL LETTER Z
0x7B    0x007B    # LEFT CURLY BRACKET
0x7C    0x007C    # VERTICAL LINE
0x7D    0x007D    # RIGHT CURLY BRACKET
0x7E    0x007E    # TILDE
#
0x80    0x00C4    # LATIN CAPITAL LETTER A WITH DIAERESIS
0x81    0x00C5    # LATIN CAPITAL LETTER A WITH RING ABOVE
0x82    0x00C7    # LATIN CAPITAL LETTER C WITH CEDILLA
0x83    0x00C9    # LATIN CAPITAL LETTER E WITH ACUTE
0x84    0x00D1    # LATIN CAPITAL LETTER N WITH TILDE
0x85    0x00D6    # LATIN CAPITAL LETTER O WITH DIAERESIS
0x86    0x00DC    # LATIN CAPITAL LETTER U WITH DIAERESIS
0x87    0x00E1    # LATIN SMALL LETTER A WITH ACUTE
0x88    0x00E0    # LATIN SMALL LETTER A WITH GRAVE
0x89    0x00E2    # LATIN SMALL LETTER A WITH CIRCUMFLEX
0x8A    0x00E4    # LATIN SMALL LETTER A WITH DIAERESIS
0x8B    0x00E3    # LATIN SMALL LETTER A WITH TILDE
0x8C    0x00E5    # LATIN SMALL LETTER A WITH RING ABOVE
0x8D    0x00E7    # LATIN SMALL LETTER C WITH CEDILLA
0x8E    0x00E9    # LATIN SMALL LETTER E WITH ACUTE
0x8F    0x00E8    # LATIN SMALL LETTER E WITH GRAVE
0x90    0x00EA    # LATIN SMALL LETTER E WITH CIRCUMFLEX
0x91    0x00EB    # LATIN SMALL LETTER E WITH DIAERESIS
0x92    0x00ED    # LATIN SMALL LETTER I WITH ACUTE
0x93    0x00EC    # LATIN SMALL LETTER I WITH GRAVE
0x94    0x00EE    # LATIN SMALL LETTER I WITH CIRCUMFLEX
0x95    0x00EF    # LATIN SMALL LETTER I WITH DIAERESIS
0x96    0x00F1    # LATIN SMALL LETTER N WITH TILDE
0x97    0x00F3    # LATIN SMALL LETTER O WITH ACUTE
0x98    0x00F2    # LATIN SMALL LETTER O WITH GRAVE
0x99    0x00F4    # LATIN SMALL LETTER O WITH CIRCUMFLEX
0x9A    0x00F6    # LATIN SMALL LETTER O WITH DIAERESIS
0x9B    0x00F5    # LATIN SMALL LETTER O WITH TILDE
0x9C    0x00FA    # LATIN SMALL LETTER U WITH ACUTE
0x9D    0x00F9    # LATIN SMALL LETTER U WITH GRAVE
0x9E    0x00FB    # LATIN SMALL LETTER U WITH CIRCUMFLEX
0x9F    0x00FC    # LATIN SMALL LETTER U WITH DIAERESIS
0xA0    0x2020    # DAGGER
0xA1    0x00B0    # DEGREE SIGN
0xA2    0x00A2    # CENT SIGN
0xA3    0x00A3    # POUND SIGN
0xA4    0x00A7    # SECTION SIGN
0xA5    0x2022    # BULLET
0xA6    0x00B6    # PILCROW SIGN
0xA7    0x00DF    # LATIN SMALL LETTER SHARP S
0xA8    0x00AE    # REGISTERED SIGN
0xA9    0x00A9    # COPYRIGHT SIGN
0xAA    0x2122    # TRADE MARK SIGN
0xAB    0x00B4    # ACUTE ACCENT
0xAC    0x00A8    # DIAERESIS
0xAD    0x2260    # NOT EQUAL TO
0xAE    0x00C6    # LATIN CAPITAL LETTER AE
0xAF    0x00D8    # LATIN CAPITAL LETTER O WITH STROKE
0xB0    0x221E    # INFINITY
0xB1    0x00B1    # PLUS-MINUS SIGN
0xB2    0x2264    # LESS-THAN OR EQUAL TO
0xB3    0x2265    # GREATER-THAN OR EQUAL TO
0xB4    0x00A5    # YEN SIGN
0xB5    0x00B5    # MICRO SIGN
0xB6    0x2202    # PARTIAL DIFFERENTIAL
0xB7    0x2211    # N-ARY SUMMATION
0xB8    0x220F    # N-ARY PRODUCT
0xB9    0x03C0    # GREEK SMALL LETTER PI
0xBA    0x222B    # INTEGRAL
0xBB    0x00AA    # FEMININE ORDINAL INDICATOR
0xBC    0x00BA    # MASCULINE ORDINAL INDICATOR
0xBD    0x03A9    # GREEK CAPITAL LETTER OMEGA
0xBE    0x00E6    # LATIN SMALL LETTER AE
0xBF    0x00F8    # LATIN SMALL LETTER O WITH STROKE
0xC0    0x00BF    # INVERTED QUESTION MARK
0xC1    0x00A1    # INVERTED EXCLAMATION MARK
0xC2    0x00AC    # NOT SIGN
0xC3    0x221A    # SQUARE ROOT
0xC4    0x0192    # LATIN SMALL LETTER F WITH HOOK
0xC5    0x2248    # ALMOST EQUAL TO
0xC6    0x2206    # INCREMENT
0xC7    0x00AB    # LEFT-POINTING DOUBLE ANGLE QUOTATION MARK
0xC8    0x00BB    # RIGHT-POINTING DOUBLE ANGLE QUOTATION MARK
0xC9    0x2026    # HORIZONTAL ELLIPSIS
0xCA    0x00A0    # NO-BREAK SPACE
0xCB    0x00C0    # LATIN CAPITAL LETTER A WITH GRAVE
0xCC    0x00C3    # LATIN CAPITAL LETTER A WITH TILDE
0xCD    0x00D5    # LATIN CAPITAL LETTER O WITH TILDE
0xCE    0x0152    # LATIN CAPITAL LIGATURE OE
0xCF    0x0153    # LATIN SMALL LIGATURE OE
0xD0    0x2013    # EN DASH
0xD1    0x2014    # EM DASH
0xD2    0x201C    # LEFT DOUBLE QUOTATION MARK
0xD3    0x201D    # RIGHT DOUBLE QUOTATION MARK
0xD4    0x2018    # LEFT SINGLE QUOTATION MARK
0xD5    0x2019    # RIGHT SINGLE QUOTATION MARK
0xD6    0x00F7    # DIVISION SIGN
0xD7    0x25CA    # LOZENGE
0xD8    0x00FF    # LATIN SMALL LETTER Y WITH DIAERESIS
0xD9    0x0178    # LATIN CAPITAL LETTER Y WITH DIAERESIS
0xDA    0x2044    # FRACTION SLASH
0xDB    0x20AC    # EURO SIGN
0xDC    0x2039    # SINGLE LEFT-POINTING ANGLE QUOTATION MARK
0xDD    0x203A    # SINGLE RIGHT-POINTING ANGLE QUOTATION MARK
0xDE    0xFB01    # LATIN SMALL LIGATURE FI
0xDF    0xFB02    # LATIN SMALL LIGATURE FL
0xE0    0x2021    # DOUBLE DAGGER
0xE1    0x00B7    # MIDDLE DOT
0xE2    0x201A    # SINGLE LOW-9 QUOTATION MARK
0xE3    0x201E    # DOUBLE LOW-9 QUOTATION MARK
0xE4    0x2030    # PER MILLE SIGN
0xE5    0x00C2    # LATIN CAPITAL LETTER A WITH CIRCUMFLEX
0xE6    0x00CA    # LATIN CAPITAL LETTER E WITH CIRCUMFLEX
0xE7    0x00C1    # LATIN CAPITAL LETTER A WITH ACUTE
0xE8    0x00CB    # LATIN CAPITAL LETTER E WITH DIAERESIS
0xE9    0x00C8    # LATIN CAPITAL LETTER E WITH GRAVE
0xEA    0x00CD    # LATIN CAPITAL LETTER I WITH ACUTE
0xEB    0x00CE    # LATIN CAPITAL LETTER I WITH CIRCUMFLEX
0xEC    0x00CF    # LATIN CAPITAL LETTER I WITH DIAERESIS
0xED    0x00CC    # LATIN CAPITAL LETTER I WITH GRAVE
0xEE    0x00D3    # LATIN CAPITAL LETTER O WITH ACUTE
0xEF    0x00D4    # LATIN CAPITAL LETTER O WITH CIRCUMFLEX
0xF0    0xF8FF    # Apple logo
0xF1    0x00D2    # LATIN CAPITAL LETTER O WITH GRAVE
0xF2    0x00DA    # LATIN CAPITAL LETTER U WITH ACUTE
0xF3    0x00DB    # LATIN CAPITAL LETTER U WITH CIRCUMFLEX
0xF4    0x00D9    # LATIN CAPITAL LETTER U WITH GRAVE
0xF5    0x0131    # LATIN SMALL LETTER DOTLESS I
0xF6    0x02C6    # MODIFIER LETTER CIRCUMFLEX ACCENT
0xF7    0x02DC    # SMALL TILDE
0xF8    0x00AF    # MACRON
0xF9    0x02D8    # BREVE
0xFA    0x02D9    # DOT ABOVE
0xFB    0x02DA    # RING ABOVE
0xFC    0x00B8    # CEDILLA
0xFD    0x02DD    # DOUBLE ACUTE ACCENT
0xFE    0x02DB    # OGONEK
0xFF    0x02C7    # CARON`;

rpnRomanDict = {};
for (let lines of rpnRomanMapping.split(rpnEndOfine)) {
    rpnRomanDict[parseInt(lines.substr(5, 6))] = parseInt(lines.substr(0, 4));
}

rpnMacRomanEncoding = function(s) {
   const chars = [];
   for (let i = 0; i < s.length; i++) {
       const u = s.codePointAt(i);
       var r = rpnRomanDict[u];
       if (!r) r = 32;
       if (r < 128) {
          chars.push(s.substr(i, 1));
       } else {
          chars.push(rpnBackSlash + r.toString(8));
       }
   }
   return chars.join("");
};

rpnSubstitutionDict = {};
rpnSubstitutionDict["/CMUSerif-Roman"] = "/Times-Roman";
rpnSubstitutionDict["/CMUSerif-Italic"] = "/Times-Italic";
rpnSubstitutionDict["/CMUSerif-Bold"] = "/Times-Bold";
rpnSubstitutionDict["/CMUSerif-BoldItalic"] = "/Times-BoldItalic";
rpnSubstitutionDict["/CMUSansSerif"] = "/Helvetica-Roman";
rpnSubstitutionDict["/CMUSansSerif-Oblique"] = "/Helvetica-Oblique";
rpnSubstitutionDict["/CMUSansSerif-Bold"] = "/Helvetica-Bold";
rpnSubstitutionDict["/CMUSansSerif-BoldOblique"] = "/Helvetica-BoldOblique";
rpnSubstitutionDict["/CMUTypewriter-Regular"] = "/Courier";
rpnSubstitutionDict["/CMUTypewriter-Oblique"] = "/Courier-Oblique";
rpnSubstitutionDict["/CMUTypewriter-Bold"] = "/Courier-Bold";
rpnSubstitutionDict["/CMUTypewriter-BoldOblique"] = "/Courier-BoldOblique";
rpnSubstitutionDict["/Courier"] = "/Courier";
rpnSubstitutionDict["/Courier-Oblique"] = "/Courier-Oblique";
rpnSubstitutionDict["/Courier-Bold"] = "/Courier-Bold";
rpnSubstitutionDict["/Courier-BoldOblique"] = "/Courier-BoldOblique";


rpnFontSubstitution = function(font) {
      if (rpnSubstitutionDict[font]) {
          return rpnSubstitutionDict[font];
      }
      return "/Courier";
};

/* TINYPS TAG */


class tinyPStag extends HTMLElement {
  // static observedAttributes = ["innerHTML", "width", "height", "format", "oversampling", "transparent", "interval"];

  constructor() {
    super();
    this.shadow = this.attachShadow({mode: "open"});
    this.ready = false;
    const elementToObserve = this;
    this.observedAttributes = ["innerHTML", "width", "height", "format", "oversampling", "transparent", "interval"];
    this.observer = new MutationObserver(function(mutationsList, observer) {
    const target = mutationsList[0].target;
    target.attributeChangedCallback("innerText","",target.innerHTML);
    });
    this.observer.observe(elementToObserve, {characterData: false, childList: true, attributes: false});
  }

  connectedCallback() {
    console.log("Connected.");
    this.ready = true;
    this.innerHTML += " ";
  }

  disconnectedCallback() {
    console.log("Custom element removed from page.");
  }

  adoptedCallback() {
    console.log("Custom element moved to new page.");
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (!this.ready) return;
    
    console.log(`Attribute ${name} has changed to ` + rpnLimitText(newValue));
    
    var context = new rpnContext;
    context.width = this.getAttribute("width") ?? 360;
    context.height = this.getAttribute("height") ?? 360;
    context.device.oversampling = this.getAttribute("oversampling") ?? 1;
    context.device.transparent = this.getAttribute("transparent") ?? 0;
    context.device.interval = this.getAttribute("interval") ?? 0;
    var divnode = document.createElement("DIV");
    var node;
    var othernode;
    
    switch(this.getAttribute("format")) {
        case "raw": 
            console.log("Adding rawnode");
            node = document.createElement("CANVAS");
            node.id = "raw" + this.id;
            node.className = "jscanvas";
            node.style.display = "block";
            node.width = context.width;
            node.height = context.height;
            context.nodes.push(new rpnRawDevice(node, null));
            context.device.raw = 1;
            break;
        case "rawurl": 
            console.log("Adding rawnode");
            othernode = document.createElement("CANVAS");
            othernode.id = "raw" + this.id;
            othernode.className = "jscanvas";
            othernode.style.display = "none";
            othernode.width = context.width;
            othernode.height = context.height;
            node = document.createElement("A");
            node.id = "raw" + this.id;
            node.innerHTML = "PNG";
            node.style.display = "block";
            context.nodes.push(new rpnRawDevice(othernode, node));
            context.device.rawurl = 1;
            break;
        case "canvasurl":
            console.log("Adding canvasurlnode");
            othernode = document.createElement("CANVAS");
            othernode.id = "canvas" + this.id;
            othernode.className = "jscanvas";
            othernode.style.display = "none";
            othernode.width = context.width;
            othernode.height = context.height;
            node = document.createElement("A");
            node.id = "canvasurl" + this.id;
            node.innerHTML = "PNG";
            node.style.display = "block";
            context.nodes.push(new rpnCanvasDevice(othernode, node));
            context.device.canvasurl = 1;
            break;
        case "svg":
            console.log("Adding svgnode");
            node = document.createElement("SVG");
            node.id = "svg" + this.id;
            node.className = "jssvg";
            node.style.display = "block";
            node.width = context.width;
            node.height = context.height;
            context.nodes.push(new rpnSVGDevice(node, null));
            context.device.svg = 1;
            break;
        case "svgurl":
            console.log("Adding svgurlnode");
            othernode = document.createElement("SVG");
            othernode.id = "svg" + this.id;
            othernode.className = "jssvg";
            othernode.style.display = "none";
            othernode.width = context.width;
            othernode.height = context.height;
            node = document.createElement("A");
            node.id = "svgurl" + this.id;
            node.innerHTML = "SVG";
            node.style.display = "block";
            context.nodes.push(new rpnSVGDevice(othernode, node));
            context.device.svgurl = 0;
            context.device.svgurl = 1;
            break;
        case "pdf":
            console.log("Adding pdfnode");
            node = document.createElement("IMG");
            node.id = "pdf" + this.id;
            node.style.display = "block";
            node.width = context.width;
            node.height = context.height;
            context.nodes.push(new rpnPDFDevice(node, null));
            context.device.pdf = 1;
            break;
        case "pdfurl":
            console.log("Adding pdfurlnode");
            node = document.createElement("IMG");
            node.id = "pdf" + this.id;
            node.style.display = "none";
            node.width = context.width;
            node.height = context.height;
            node = document.createElement("A");
            node.id = "pdfurl" + this.id;
            node.innerHTML = "PDF";
            node.style.display = "block";
            context.nodes.push(new rpnPDFDevice(othernode, node));
            context.device.pdfurl = 1;
            break;
        case "canvas":
        default:
            console.log("Adding canvasnode");
            node = document.createElement("CANVAS");
            node.id = "canvas" + this.id;
            node.className = "jscanvas";
            node.style.display = "block";
            node.width = context.width;
            node.height = context.height;

            context.nodes.push(new rpnCanvasDevice(node, null));
            context.device.canvas = 1;
            break;
    }
    // divnode.appendChild(node);
    //  this.shadow.innerHTML = divnode.outerHTML;
    this.shadow.innerHTML = "";
    this.shadow.appendChild(node);
    context.nodes[0].clear(context.width, context.height, context.device.oversampling, context.device.transparent);
    context.shadow = this.shadow;
    context = rpn(this.innerHTML, context, true);
    if (context.lasterror) {
        console.error("!" + context.lasterror);
        console.log("Stack: " + context.stack.reduce((acc,v) => acc + v.dump + " " , " "));
        console.log("Code executed: " + context.currentcode);
    }
    
  }
}
customElements.define("tiny-ps", tinyPStag);
