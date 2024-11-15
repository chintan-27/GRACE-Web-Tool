import SimpleITK as sitk

def resample_image_sitk(image_path, output_path, new_size=(64, 64, 64)):
    # Read the image
    image = sitk.ReadImage(image_path)
    
    # Get the original image size and spacing
    original_size = image.GetSize()
    original_spacing = image.GetSpacing()
    
    # Calculate new spacing based on the new size
    new_spacing = [
        original_spacing[i] * (original_size[i] / new_size[i]) 
        for i in range(3)
    ]
    
    # Set up the resample filter
    resampler = sitk.ResampleImageFilter()
    resampler.SetSize(new_size)
    resampler.SetOutputSpacing(new_spacing)
    resampler.SetOutputOrigin(image.GetOrigin())
    resampler.SetOutputDirection(image.GetDirection())
    resampler.SetInterpolator(sitk.sitkLinear)
    
    # Resample the image
    resampled_image = resampler.Execute(image)
    
    # Save the resampled image
    sitk.WriteImage(resampled_image, output_path)

# Example usage
resample_image_sitk("1.nii.gz", "output_image_resampled.nii.gz")
