
const parser = require('./protos-parser.js');
const mappoint = require('mappoint');

const internalCephesFunctions = [
  'hyp2f0', 'onef2', 'threef0'
];

const type2llvm = {
  'double': 'double',
  'int': 'i32'
}

const argGenerators = {
  double: function (name) {
    let code = '';
    code += `  // argument: double ${name}\n`;
    code += `  if (typeof ${name} !== 'number') {\n`;
    code += `    throw new TypeError('${name} must be a number');\n`;
    code += `  }\n`;
    code += `  const carg_${name} = ${name};\n`;
    return code;
  },

  int: function (name) {
    let code = '';
    code += `  // argument: int ${name}\n`;
    code += `  if (typeof ${name} !== 'number') {\n`;
    code += `    throw new TypeError('${name} must be a number');\n`;
    code += `  }\n`;
    code += `  const carg_${name} = ${name} | 0;\n`;
    return code;
  },

  "double*": function (name) {
    let code = '';
    code += `  // argument: double* ${name}\n`;
    code += `  const carg_${name} = cephes.stackAlloc(8); // No need to zero-set it.\n`;
    return code;
  },

  "int*": function (name) {
    let code = '';
    code += `  // argument: int* ${name}\n`;
    code += `  const carg_${name} = cephes.stackAlloc(4); // No need to zero-set it.\n`;
    return code;
  },

  "double[]": function (name) {
    let code = '';
    code += `  // argument: double[] ${name}\n`;
    code += `  const carg_${name} = cephes.stackAlloc(${name}.length << 3);\n`;
    code += `  if (Array.isArray(${name})) {\n`;
    code += `    cephes.writeArrayToMemory(new Uint8Array(new Float64Array(${name}).buffer), carg_${name});\n`;
    code += `  } else if (${name} instanceof Float64Array) {\n`;
    code += `    cephes.writeArrayToMemory(new Uint8Array(${name}.buffer), carg_${name});\n`;
    code += `  } else {\n`;
    code += `    throw new TypeError('${name} must be either an Array or Float64Array');\n`;
    code += `  }\n`;
    return code;
  }
};

const header = `
const cephes = require('./cephes.js');

`;

process.stdout.write(header);

process.stdin
  .pipe(parser())
  .pipe(mappoint({ objectMode: true }, function (data, done) {
    const {returnType, functionName, functionArgs} = data;

    // Skip some internal functions
    if (internalCephesFunctions.includes(functionName)) {
      return done(null);
    }

    // Check if the stack will be needed because of isPointer or isArray
    const needStack = functionArgs.some((arg) => arg.isArray || arg.isPointer);

    // Check if there is extra data returned
    const extraReturn = functionArgs.some((arg) => arg.isPointer);

    //
    // Start code generation
    //
    let code = '';

    //
    // function header
    //

    // function name
    code += `exports.${functionName} = function ${functionName}(`
    // function arguments
    for (const {type, isPointer, isArray, name} of functionArgs) {
      if (isPointer) continue;
      code += `/* ${type}${isArray ? '[]' : ''} */ ${name}, `;
    }
    // Remove training comma
    code = code.slice(0, -2);
    // finish function header
    code += `) {\n`;

    if (needStack) {
      code += '  //Save the STACKTOP because the following code will do some stack allocs\n';
      code += `  const stacktop = cephes.stackSave();\n`;
      code += '\n';
    }

    //
    // function arguments
    //
    for (const {fullType, name} of functionArgs) {
      code += argGenerators[fullType](name);
      code += '\n';
    }

    //
    // function call
    //
    code += `  // return: ${returnType}\n`;
    // function call
    code += `  const fn_ret = cephes._cephes_${functionName}(`;
    // function arguments
    for (const { name } of functionArgs) {
      code += `carg_${name}, `;
    }
    // Remove training comma
    code = code.slice(0, -2);
    // finish function header
    code += `)${returnType === 'int' ? ' | 0' : ''};\n`;
    code += '\n';

    //
    // function return
    //
    if (extraReturn) {
      code += '  // There are pointers, so return the values of thoese too\n';
      code += '  const ret = [fn_ret, {\n';
      for (const { isPointer, name, type } of functionArgs) {
        if (!isPointer) continue;
        code += `    '${name}': cephes.getValue(carg_${name}, '${type2llvm[type]}'),\n`;
      }
      code += '  }];\n';
    } else {
      code += ' // No pointers, so just return fn_ret\n';
      code += '  const ret = fn_ret;\n';
    }
    code += '\n';

    //
    // function footer
    //
    if (needStack) {
      code += '  // Restore internal stacktop before returning\n';
      code += '  cephes.stackRestore(stacktop);\n';
    }
    code += '  return ret;\n';
    code += '};\n';
    code += '\n';

    done(null, code);
  }))
  .pipe(process.stdout)
