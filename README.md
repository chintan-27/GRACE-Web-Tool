# GRACE Web Tool

A web-based whole-head MRI segmentation platform powered by deep learning. Upload a NIfTI MRI volume and receive automated tissue segmentation across 12 classes using state-of-the-art neural network architectures.

## What It Does

GRACE Web Tool segments whole-head MRI scans into 12 tissue classes:

| Label | Tissue |
|-------|--------|
| 0 | Background |
| 1 | White Matter (WM) |
| 2 | Gray Matter (GM) |
| 3 | Eyes |
| 4 | Cerebrospinal Fluid (CSF) |
| 5 | Air |
| 6 | Blood |
| 7 | Cancellous Bone |
| 8 | Cortical Bone |
| 9 | Skin |
| 10 | Fat |
| 11 | Muscle |

## Models

Six models are available, spanning three architectures and two coordinate spaces:

| Architecture | Native Space | FreeSurfer Space |
|-------------|-------------|-----------------|
| **GRACE** | `grace-native` | `grace-fs` |
| **DOMINO** | `domino-native` | `domino-fs` |
| **DOMINO++** | `dominopp-native` | `dominopp-fs` |

- **Native space** outputs match the input MRI's original coordinate system.
- **FreeSurfer space** outputs are conformed to FreeSurfer's 1mm isotropic 256x256x256 standard space.

## Features

- **Upload & Segment** -- Upload a NIfTI (.nii / .nii.gz) MRI volume and select one or more models to run
- **Interactive Viewer** -- Built-in Niivue-based 3D/2D viewer with side-by-side model comparison
- **Multiple Colormaps** -- Switch between FreeSurfer, Viridis, Plasma, and other colormaps with a dynamic tissue legend
- **Real-time Progress** -- Server-Sent Events stream processing status to the browser as inference runs
- **GPU Scheduling** -- Multi-GPU job queue with Redis-backed scheduling for concurrent users
- **Result Download** -- Download segmentation outputs as NIfTI files

## Architecture

```
ui_v2/          Next.js frontend (Niivue viewer, shadcn/ui, Tailwind CSS)
api_v2/         FastAPI backend (Redis job queue, GPU scheduler, SSE streaming)
```

### Workflow

1. User uploads a NIfTI MRI volume and selects models + coordinate space
2. Backend creates a session, preprocesses the input (RAS orientation, 1mm resampling), and enqueues a job
3. GPU scheduler assigns the job to an available GPU and runs inference
4. Progress is streamed to the frontend via SSE
5. Results are visualized in the interactive viewer and available for download
