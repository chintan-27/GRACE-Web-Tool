// resize_nifti.cpp
#include "itkImage.h"
#include "itkImageFileReader.h"
#include "itkImageFileWriter.h"
#include "itkResampleImageFilter.h"
#include "itkAffineTransform.h"
#include "itkLinearInterpolateImageFunction.h"

using PixelType = float;
constexpr unsigned int Dimension = 3;
using ImageType = itk::Image<PixelType, Dimension>;

extern "C" {

int resizeNifti(const char* inputBuffer, size_t inputSize, char** outputBuffer, size_t* outputSize, double scaleFactor) {
    // Create memory buffer from inputBuffer
    itk::DataObject::Pointer inputDataObject = itk::DataObject::New();
    inputDataObject->SetBufferAsBinary(inputBuffer, inputSize);

    // Reader
    auto reader = itk::ImageFileReader<ImageType>::New();
    reader->SetInputData(inputDataObject);

    // Resample filter
    auto resampleFilter = itk::ResampleImageFilter<ImageType, ImageType>::New();
    resampleFilter->SetInput(reader->GetOutput());

    // Transform
    auto transform = itk::AffineTransform<double, Dimension>::New();
    transform->Scale(scaleFactor);
    resampleFilter->SetTransform(transform);

    // Interpolator
    auto interpolator = itk::LinearInterpolateImageFunction<ImageType, double>::New();
    resampleFilter->SetInterpolator(interpolator);

    // Update filter
    try {
        resampleFilter->Update();
    } catch (itk::ExceptionObject &err) {
        return -1;
    }

    // Writer
    auto writer = itk::ImageFileWriter<ImageType>::New();
    writer->SetInput(resampleFilter->GetOutput());

    // Write to memory buffer
    std::ostringstream oss;
    writer->SetOutputStream(&oss);
    writer->Write();

    // Copy output to outputBuffer
    std::string outputStr = oss.str();
    *outputSize = outputStr.size();
    *outputBuffer = (char*)malloc(*outputSize);
    memcpy(*outputBuffer, outputStr.data(), *outputSize);

    return 0;
}

}
