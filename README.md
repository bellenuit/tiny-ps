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
        <script src = "source/tinyps100.js"></script>
    </body>
</html>
```

will display as 

![PS-46](https://github.com/user-attachments/assets/a6e64d9e-df92-4a52-857f-e9ad1b5f661b)

More examples here: http://belle-nuit.com/site/files/minimal14.html

## Node attributes

The node has the following attributes. Changing them will be reflected by the browser.

- width
- height
- format (canvas as default, pdf (currently Safari only), raw, svg comme image, canvasurl, pdfurl, rawurl, svgurl as downloadable link)
- transparent (0 as default, except PDF which is always white paper)
- oversampling (1 as default, 2 improves detail for raw)
- interval (0 as default, in msec). You can have multiple pages which will be displayed by this delay.

The node displays as block by default, but you can set it to inline-block with the CSS

## The PostScript language

It is not the place here to make a tutorial of the PostScript language. 
There are many references on my blog where I covered the creation of this library
https://belle-nuit.com/my-journey-to-postscript

This said, PostScript is a stack based language in RPN notation. 
Basically, PostScript is a very long string of words which the interpreter reads and processes one at the time. 
The words have direct effects on a calculation stack. In this aspect, PostScript is comparable with Forth or a HP calculator.
But the interesting part is the side effects. 
It starts with a white page. 
PostScript manipulates a graphic state, create paths and then either fills (like a child) or strokes (like with a pencil) the path.
When all objects are painted or drawn, the page is ready.

There are sevral types of words
- Numbers which can be positive or negative and be integer or fractional: **5** **3.41** **-2** **0**. Booleans are also numbers. 0 is false, 1 or every other value is true.
- Strings are in paranthesises **(Hello World)**
- Procedures are simple words (starting with a letter, continuing with letter, number or hyphen), that are immediately executed **add** **lineto**
- Names are variables which attend to be defined. They have a slasg before the word **/inch 72 def**. Once defined, they can be used as word. Note that every procedure can be redefined during the execution. PostScript is hihly dynamic (and not compileable)
- Unnamed procedures can be defined with curly braces **{ 2 add }** will be put as a procedure on the stack, but not execded. The use case would be to define a procedure **/double { 2 add } def** and then use it **7 double**
- Arrays can be defined with square brackets **[ 2 3 4 ]** puts that array on the stack. Note that elements in the array are executed as they arrive, so **[[ 2 3 add 4 ]** is equivalent to **[ 5 4 ]**
- You are free to organise your space around, there are no separators. If you want to comment your code, start with **%** at the beginning or anywhere in a line. Everything until newline will be ignored.

## Supported PostScript operators

tiny-ps ony supports a subset of the PostScript language. In some cases, it extends is (PostScript does not know transparency). 
All predefined operators are listed here with their syntax. I will not explain them. Look at the examples or consult the excelllent documentation here. 
It helped me out multiple times
https://hepunx.rl.ac.uk/~adye/psdocs/ref/REF.html

The sytax is shown as this: On the left of the operastor the expected values in the stack in there order, on the right the values the operator puts on the stack

### Math

a b **add** number

denum num **atan** number (returns angle of a slope)

a **cos** number

a b **div** number

a b **idiv** number

a b **mod** number

a b **mul** number

a **neg** -a

a **round** a

a **sin** number

a b **sub** number

### Logic

a b **and** boolean

a b **eq** boolean

**false** 0

a b **ge** boolean

a b **gt** boolean

a b **le** boolean

a b **lt** boolean

a b **ne** boolean

a b **le** boolean

a **not** boolean

a b **or** boolean

**true** 1

### Path

centerx, centery radius angle1 angle2 **arc** (independent path, without starting point needed, angle in 360 degrees)

x1 y1 x2 y2 r **arcto** (for rounded rectangles)

**clip** (clips the render region to the current path)

**closepath** (you need that to fill)

**currentalpha** number (not native between 0 transparent and 1 opaque )

**currentgray** number (between 0 black and 1 white)

**currentlinewidth** number

**currentpoint** x y

**currentrgbcolor** r g b (between 0 and 1)

bx by cx cy x y **curveto** (bezier)

**eofill** (even odd fill)

**fill**

**initgraphics**

x y **lineto**

x y **moveto**

**newpath**

qx qy x y **qcurveto** (quadratic)

bx by cx cy x y **rcurveto** (bezier)

x y **rlineto**

x y **rmoveto**

a **setalpha** (not native)

x **setgray** 

x **setlinewidth**

r g b **setrgbcolor**

arrayof6 **setmatrix**

**stroke**

### Text

string **charpath***

fontdictonary name **definefont*** 

name **findfont** fontdictonary

string n **get** value

string start length **getinterval** string

string **length** number

string n any **put**

string start length any **putinterval**

fontdictonary n **scalefont** fontdictonary

source seek **search** foundstring

wx wy llx lly urx ury **setcachedevice**

fontdictionary **setfont**

string **show** x y (needs moveto to set initial position)

n **string** string

string **stringwidth** w h

cx cy ch string **widthshow** x y (ch is space in Ascii code)

### Transformation

**currentmatrix** [ 1 0 0 1 0 0 ]

**grestore** (restores the last saved graphics state)

**gsave** (saves the currrent graphics state to the graphics stack)

x y **itransform** x0 y0 (from device space to user space)

angle **rotate**

x y **scale**

x y **transform** x0 y0 (from user space to device space)

x y **translate** 

### Array

n **array** array (an empty array of n elements, PostScript is from a time of limited memory)

array n **get** value

array start length **getinterval** array

array **length** number

array n any **put**

array start length any **putinterval**

## Stack

**count** number (stack depth)

a **dup** a a

a b **exch** b a

a..n i **index** a..n value(i)

a..m n **pop** a..m

a..i a b **roll** a..i (rolled stack)

### Dictionary

dict **begin** (push the dictionary on the dictionary stack, making it the current dictionary)

**currentdict*** dict 

name any **def**

n **dict** dict

**end** (removes current dictonary from the dictionary stack)

dictionary name **get** value

dictionary key **known** boolean

dict **readonly** (stub not implemented)

### Execution

**bind** (stub not implemented)

a..i n **copy*** a..i (n times)

procedure **exec**

**exit** (exit current loop)

initial imncrement limit procedure **for**

procedure condition **if**

procedure procedure2 condition **ifelse**

procedure **loop** (don't forget exit in procedure)

n procedure **repeat**

file **run** (is not actually reading a file. string of file must be bound for use to object rpnFiles, here you need JavaScript).

### Device

dictionary **setpagedevice** (possible keys: canvas, canvasurl, color, console, height, oversampling, interval, pdf, pdfurl, raw, rswurl, svg, svgurl, textmode, transparent, width, height)

**showpage** (don't forget that one)

## Architecture

tinyPStag is an extension of HTML-element. It observes changes of the tiny-ps tag node, creates CANVAS, SVG or A nodes in the shadow DOM.

rpnContext is the memory of the processor. It holds the stack, the dictionary stack, the graphics stack, the devices information and references to the nodes.

tinyPStag creates a context and handles it together with the PostScript code to rpn, the processor.

rpn reads each word of the code and processes it: It either puts it on the stack or it runs a procedure, which may be a built in operator or a defined procedure. 

rpnOperators read from the stack, process and write to the stack. Sometimes they have effects on the dictionary and the graphics state. Sometimes they even call rpn in a recursive way. Some operators work on the devices (fill show showpage stroke)

rpnDevices fill and stroke paths in their repsective way. rpnCanvasDevice draws on the Canvas using the Canvas API. rpnSVGDevice converts them to SVG elements. rpnPDFDevice writes PDF manually. All devices can produce images but also downloadable links (data URL).

A bigger part of the code is rpnTTF who parses, with the help of rpnBinary TrueType files. 

## rpnRawDevice

A special device is rpnRawDevice. This code has started as an academic excerice to understand and build the processor from the ground up using only mathematical methods and no API. Several algorithms had to be created aside from the rpn stack processor.

- rpnScanFill to fill closed polygons (using both even odd and zero winding rules)
- rpnBezier to convert curves to straight lines so that we can make polygons
- a method to convert a stroke of a certain thickness to a polygon.
- a mtehod to clip
- a method to handle correctly painting with alpha channel on transparent objects.

# Font paths

If your fonts are not in the same folder than the HTML file, you will need to write a line of code after importing the script to redirect. The path must be defined relative to the base path of the HTML file.

```
rpnFontBasePath = <PATH>;
```

# PostScript Errors

If your code has error, the processor will stop and error will be shown in the Browser console:

- Error type: **!typeerror** **!stackunderflow** **!stackunderflow** 
- Current stack
- Read trail until error (note that this code may have been expanded during execution)


# Bugs

If you have any bugs, please post an issue on Github. Please add the following informations

- PostScript code
- Browser
- Expected result
- Received result (screenshot)
