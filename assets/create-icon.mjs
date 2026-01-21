import fs from 'fs';

// ICO file format for a 256x256 solid #070707 PNG icon
// This is a base64 encoded PNG of a solid #070707 (rgb(7, 7, 7)) 256x256 image
const pngData = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAQAAAAEAAQMAAABmvDolAAAABlBMVEX///8AAABVwtN+AAAAAXRS' +
  'TlMAQObYZgAAAAxJREFUeNrtwTEBAAAAwqD1T20JT6AAAH4MAAAAAElFTkSuQmCC',
  'base64'
);

// ICO header (6 bytes)
const icoHeader = Buffer.alloc(6);
icoHeader.writeUInt16LE(0, 0);      // Reserved (must be 0)
icoHeader.writeUInt16LE(1, 2);      // Image type (1 = ICO)
icoHeader.writeUInt16LE(1, 4);      // Number of images

// Directory entry (16 bytes)
const dirEntry = Buffer.alloc(16);
dirEntry.writeUInt8(0, 0);          // Width (0 = 256)
dirEntry.writeUInt8(0, 1);          // Height (0 = 256)
dirEntry.writeUInt8(0, 2);          // Color palette count (0 = no palette)
dirEntry.writeUInt8(0, 3);          // Reserved
dirEntry.writeUInt16LE(1, 4);       // Color planes (1)
dirEntry.writeUInt16LE(32, 6);      // Bits per pixel (32)
dirEntry.writeUInt32LE(pngData.length, 8);  // Size of image data
dirEntry.writeUInt32LE(22, 12);     // Offset of image data (6 + 16 = 22)

// Combine all parts
const icoFile = Buffer.concat([icoHeader, dirEntry, pngData]);

// Write the .ico file
fs.writeFileSync('assets/icon.ico', icoFile);
console.log('Created assets/icon.ico with solid #070707 color');
