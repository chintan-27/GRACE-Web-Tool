import { Tensor } from 'onnxruntime-web';

function fileToTensor(file: File): Promise<Tensor> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (event) => {
            const arrayBuffer = event.target?.result as ArrayBuffer;
            const imageData = new Float32Array(arrayBuffer); // Use Float32Array for NIfTI image data
            console.log(imageData)
            const dims = [1, 64, 64, 64]; // Shape of the tensor: [batch, depth, height, width]
            const float32Data = new Float32Array(dims[1] * dims[2] * dims[3]);

            for (let i = 0; i < float32Data.length; i++) {
                if (i < imageData.length) {
                    float32Data[i] = imageData[i]; // Directly use the NIfTI image data
                }
            }

            const inputTensor = new Tensor("float32", float32Data, dims);
            resolve(inputTensor);
        };
        reader.onerror = (error) => reject(error);
        reader.readAsArrayBuffer(file);
    });
}
export { fileToTensor };