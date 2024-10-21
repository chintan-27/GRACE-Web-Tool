import * as ort from 'onnxruntime-web';
import { fileToTensor } from './fileHelper';
import _ from 'lodash';

const applySoftmax = (logits: Float32Array, shape: number[]): [Float32Array, number[]] => {
    const [batchSize, numClasses, ...spatialDims] = shape;
    const result = new Float32Array(logits.length);
    const spatialSize = _.reduce(spatialDims, (a, b) => a * b, 1);

    _.times(batchSize, (b) => {
        _.times(spatialSize, (s) => {
            const max = _.max(_.map(_.range(numClasses), (c) => 
                logits[(b * numClasses * spatialSize) + (c * spatialSize) + s]
            )) || 0;

            const exps = _.map(_.range(numClasses), (c) => {
                const index = (b * numClasses * spatialSize) + (c * spatialSize) + s;
                return Math.exp(logits[index] - max);
            });

            const sum = _.sum(exps);

            _.forEach(_.range(numClasses), (c) => {
                const index = (b * numClasses * spatialSize) + (c * spatialSize) + s;
                result[index] = exps[c] / sum;
            });
        });
    });

    return [result, spatialDims];
};

const runModel = async (session: ort.InferenceSession, data: ort.Tensor) : Promise<[Float32Array, number]> => {
    const startTime = performance.now();
    // Add a batch dimension to the input tensor
    const batchedData = new ort.Tensor('float32', data.data, [1, ...data.dims]);
    const output = await session.run({ input: batchedData });
    const endTime = performance.now();
    const timeTaken = endTime - startTime;
    const [softmaxOutput, dims] = applySoftmax(output.output.data as Float32Array, output.output.dims as number[]);
    console.log(data.dims);
    console.log(output.output.dims);
    console.log(dims);

    // Convert softmaxOutput from [1, 12, 64, 64, 64] to [64, 64, 64]
    const [, numClasses, ...spatialDims] = output.output.dims;
    const finalOutput = new Float32Array(spatialDims[0] * spatialDims[1] * spatialDims[2]);
    
    for (let x = 0; x < spatialDims[0]; x++) {
        for (let y = 0; y < spatialDims[1]; y++) {
            for (let z = 0; z < spatialDims[2]; z++) {
                let maxClass = 0;
                let maxProb = softmaxOutput[x * spatialDims[1] * spatialDims[2] + y * spatialDims[2] + z];
                
                for (let c = 1; c < numClasses; c++) {
                    const prob = softmaxOutput[c * spatialDims[0] * spatialDims[1] * spatialDims[2] + x * spatialDims[1] * spatialDims[2] + y * spatialDims[2] + z];
                    if (prob > maxProb) {
                        maxProb = prob;
                        maxClass = c;
                    }
                }
                
                finalOutput[x * spatialDims[1] * spatialDims[2] + y * spatialDims[2] + z] = maxClass;
            }
        }
    }

    return [finalOutput, timeTaken];
}

const infer = async (file: File): Promise<[Float32Array, number]> => {
    console.log("Starting inference");
    const session = await ort.InferenceSession.create("grace.onnx", { 
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
        enableCpuMemArena: true,
        enableMemPattern: true,
        executionMode: 'sequential',
        enableWebAssembly: true
    });
    console.log('Inference session created');
    const data = await fileToTensor(file);
    console.log(data)
    let [results, time] = await runModel(session, data);
    
    // Normalize results to be between 0 and 1
    const maxValue = _.max(results);
    if (maxValue !== undefined && maxValue !== 0) {
        results = _.map(results, (value : any) => value / maxValue);
    }

    console.log('Results converted to file');
    return [results, time];
}

export { infer };
