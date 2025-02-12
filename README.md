# tiny-ps
Web component to display PostScript graphics inside HTML

What if you could write PostScript code right away in a webpage and it would be on the page together with the HTML code?

tiny-ps is a custom web component that renders the code to Canvas, SVG, PDF and shoiw this either as an image or provide a downloadable link.

tiny-ps is a small JavaScript (~150 KB), no dependencies, completely self-contained. You import the script and forget about it.

Why would you want to use PostScript? 
While HTML is versatile, it cannot display anything. 
Canvas is programmable, but Bitmap. 
SVG is vector graphics, but difficult to programm.
PostScript is both vector graohics and programmable. Practically everything that has been printed the last 40 years is based on PostScript. PDF uses the graophic engine of PostScript without the programming. 

Programmable means the rendering is on the browser client side. Depending on your content, you might have to transfer less data. 
Programmable means also that is suited for dynamic content, database driven layouts and visualizations.

## Installation

Download the source file *tinyps100.js* and include it in your webpage. 
If you want to use it to render text, you may also want to install TrueType fonts from the same folder or your own fonts.

## First example

```html
<html>
    <head></head>
    <body>
        <tiny-ps id="ps" width="590" height="330" format="canvas">
/triangle { moveto 100 0 rlineto -50 100 rlineto closepath } def
0.2 setgray 200 100 triangle fill
0.4 setgray 240 140 triangle fill
1.0 setgray 280 180 triangle fill
0.0 setgray 280 180 triangle stroke
showpage
        </tiny-ps>
        <script src = "ps20250211.js"></script>
    </body>
</html>
```
