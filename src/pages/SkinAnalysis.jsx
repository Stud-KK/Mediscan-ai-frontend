import { useState, useRef, useEffect } from "react";
import axios from "axios";
import { GoogleGenerativeAI } from "@google/generative-ai";
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import Header from '../components/Header';
import { useSelector, useDispatch } from 'react-redux';
import { addMedicalHistory } from '../actions/userActions';
import Disclaimer from '../components/Disclaimer';
import AnalysisResults from '../components/AnalysisResults';
import { useNavigate } from 'react-router-dom';

const genAI = new GoogleGenerativeAI("AIzaSyAuQy68_9hLOzWYmt_NYryjBQVQf0PHBok");

const uploadToCloudinary = async (file) => {
    console.log("Starting Cloudinary upload...", file);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", "teleconnect");

    try {
        const response = await axios.post(
            "https://api.cloudinary.com/v1_1/dfwzeazkg/image/upload",
            formData
        );
        console.log("Cloudinary upload successful:", response.data.secure_url);
        return response.data.secure_url;
    } catch (error) {
        console.error("Error uploading to Cloudinary:", error);
        console.error("Error details:", error.response?.data);
        throw error;
    }
};

const formatAnalysisResults = (text) => {
    const lines = text.split('\n').filter(line => line.trim() !== '');

    return lines.map((line, index) => {
        // Remove asterisks and format based on content
        const cleanLine = line.replace(/\*\*/g, '');

        if (cleanLine.match(/^(Medical Condition|Confidence Score|Type|Affected Region|Recommendation|Additional Observations)/i)) {
            return {
                type: 'header',
                content: cleanLine
            };
        }
        return {
            type: 'content',
            content: cleanLine
        };
    });
};

const simplifyAnalysis = async (medicalAnalysis) => {
    console.log("Starting analysis simplification...");
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        const prompt = `You are a medical translator who specializes in explaining complex medical terms in simple, easy-to-understand language. 
        Please convert this medical analysis into simple terms that someone without a medical background can understand.
        Keep the same structure but use everyday language. Here's the analysis:
        ${medicalAnalysis}
        Please provide the simplified version while maintaining the key information.`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const simplifiedText = response.text();
        console.log("Analysis simplified successfully");
        return simplifiedText;
    } catch (error) {
        console.error("Error simplifying analysis:", error);
        throw new Error("Failed to simplify the analysis. Please try again.");
    }
};

const analyzeImage = async (imageUrl) => {
    console.log("Starting image analysis...", imageUrl);
    try {
        // Fetch image and convert to Base64
        console.log("Fetching image from URL...");
        const response = await fetch(imageUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
        }
        const blob = await response.blob();
        console.log("Image fetched successfully, converting to base64...");

        const base64Image = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            reader.onloadend = () => {
                const result = reader.result.split(",")[1];
                console.log("Base64 conversion successful");
                resolve(result);
            };
            reader.onerror = (error) => {
                console.error("FileReader error:", error);
                reject(error);
            };
        });

        // Analyze with Gemini
        console.log("Sending to Gemini for analysis...");
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        
        const analysisPrompt = `You are an expert dermatologist specializing in skin condition detection. 
        Analyze the provided skin image and determine whether it indicates any concerning conditions. 
        Provide a confidence score (in percentage) for your diagnosis. 
        If a condition is detected, also mention the type and affected region with a probability score and in a user-friendly language.
        
        Additionally, assign an emergency level (1-3):
        - Level 1: High emergency (immediate medical attention required)
        - Level 2: Moderate emergency (prompt medical attention needed)  
        - Level 3: Low emergency (routine care recommended)
        
        Format your response as:
        EMERGENCY_LEVEL: [1/2/3]
        
        [Your detailed analysis here]`;

        const result = await model.generateContent([
            {
                text: analysisPrompt
            },
            {
                inlineData: {
                    mimeType: "image/jpeg", // Changed from png to jpeg for better compatibility
                    data: base64Image
                }
            }
        ]);

        const aiResponse = await result.response;
        const responseText = aiResponse.text();
        console.log("Gemini analysis completed:", responseText);

        // Extract emergency level
        const emergencyMatch = responseText.match(/EMERGENCY_LEVEL:\s*(\d)/);
        const emergencyLevel = emergencyMatch ? parseInt(emergencyMatch[1]) : 3; // Default to level 3
        
        // Remove emergency level from response text
        const cleanResponse = responseText.replace(/EMERGENCY_LEVEL:\s*\d\s*/, '').trim();

        return {
            formattedResponse: cleanResponse,
            emergencyLevel: emergencyLevel
        };
    } catch (error) {
        console.error("Error analyzing image:", error);
        console.error("Error stack:", error.stack);
        throw error;
    }
};

export default function SkinAnalysis() {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const [selectedImage, setSelectedImage] = useState(null);
    const [imagePreview, setImagePreview] = useState(null);
    const [analysis, setAnalysis] = useState(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [logoImageData, setLogoImageData] = useState(null);
    const [isSimplifying, setIsSimplifying] = useState(false);
    const [isSimplified, setIsSimplified] = useState(false);
    const fileInputRef = useRef(null);
    const { user } = useSelector(state => state.user);
    const [emergencyLevel, setEmergencyLevel] = useState(null);
    const [countdown, setCountdown] = useState(5);
    const [showRedirect, setShowRedirect] = useState(false);
    const [isRedirecting, setIsRedirecting] = useState(false);
    const [error, setError] = useState(null);

    // Load logo image when component mounts
    useEffect(() => {
        const loadLogo = async () => {
            try {
                console.log("Loading logo...");
                const img = new Image();
                img.crossOrigin = 'Anonymous';
                img.src = './logo.png';

                img.onload = () => {
                    console.log("Logo loaded successfully");
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    const dataURL = canvas.toDataURL('image/png');
                    setLogoImageData(dataURL);
                };

                img.onerror = (error) => {
                    console.error('Error loading logo:', error);
                };
            } catch (error) {
                console.error('Error in loadLogo function:', error);
            }
        };
        loadLogo();
    }, []);

    const handleImageChange = (e) => {
        console.log("Image selected:", e.target.files[0]);
        const file = e.target.files[0];
        if (file) {
            // Validate file type
            if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
                setError('Please select a valid image or video file.');
                return;
            }

            // Validate file size (e.g., max 10MB)
            if (file.size > 10 * 1024 * 1024) {
                setError('File size must be less than 10MB.');
                return;
            }

            setError(null);
            setSelectedImage(file);
            const reader = new FileReader();
            reader.onloadend = () => {
                console.log("Image preview generated");
                setImagePreview(reader.result);
            };
            reader.onerror = (error) => {
                console.error("FileReader error:", error);
                setError('Error reading file.');
            };
            reader.readAsDataURL(file);
        }
    };

    const handleUploadAndAnalyze = async () => {
        if (!selectedImage) {
            setError('Please select an image first.');
            return;
        }

        console.log("Starting upload and analysis process...");
        setIsAnalyzing(true);
        setAnalysis(null);
        setEmergencyLevel(null);
        setShowRedirect(false);
        setCountdown(5);
        setIsRedirecting(false);
        setError(null);

        try {
            // Upload to Cloudinary
            const cloudinaryUrl = await uploadToCloudinary(selectedImage);
            console.log("Upload successful, starting analysis...");
            
            // Check if the file is a video
            const isVideo = selectedImage.type.startsWith('video/');
            
            if (isVideo) {
                console.log("Processing video file...");
                // For videos, send to localhost endpoint
                const response = await fetch('http://localhost:5050/api/analyze-video', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        video_url: cloudinaryUrl,
                        description: ""
                    })
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    console.error('Video analysis failed:', response.status, errorText);
                    throw new Error(`Failed to analyze video: ${response.status} ${response.statusText}`);
                }

                const data = await response.json();
                console.log("Video analysis completed:", data);
                setAnalysis(data.analysis);
                setEmergencyLevel(data.emergencyLevel || 3);
            } else {
                console.log("Processing image file...");
                // For images, use Gemini directly
                const analysisResult = await analyzeImage(cloudinaryUrl);
                setAnalysis(analysisResult.formattedResponse);
                setEmergencyLevel(analysisResult.emergencyLevel);
            }

            console.log("Analysis completed successfully");
            setShowRedirect(true);

            // Update medical history if user is logged in and analysis is valid
            if (user && analysis && typeof analysis === 'string' && analysis.trim() !== '') {
                console.log("Updating medical history...");
                try {
                    dispatch(addMedicalHistory(analysis, cloudinaryUrl));
                    console.log("Medical history updated successfully");
                } catch (historyError) {
                    console.error("Error updating medical history:", historyError);
                    // Don't throw this error as it's not critical to the main flow
                }
            }
        } catch (error) {
            console.error("Error in upload and analysis process:", error);
            setError(`Error processing file: ${error.message}`);
            setAnalysis(null);
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log("File dropped");

        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            const file = e.dataTransfer.files[0];
            
            // Validate file type
            if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
                setError('Please drop a valid image or video file.');
                return;
            }

            // Validate file size
            if (file.size > 10 * 1024 * 1024) {
                setError('File size must be less than 10MB.');
                return;
            }

            setError(null);
            setSelectedImage(file);

            const reader = new FileReader();
            reader.onloadend = () => setImagePreview(reader.result);
            reader.onerror = (error) => {
                console.error("FileReader error:", error);
                setError('Error reading dropped file.');
            };
            reader.readAsDataURL(file);
        }
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const resetAnalysis = () => {
        console.log("Resetting analysis...");
        setSelectedImage(null);
        setImagePreview(null);
        setAnalysis(null);
        setError(null);
        setEmergencyLevel(null);
        setShowRedirect(false);
        setIsSimplified(false);
    };

    const handleSimplify = async () => {
        if (!analysis) {
            setError('No analysis available to simplify.');
            return;
        }

        setIsSimplifying(true);
        setError(null);
        try {
            const simplifiedAnalysis = await simplifyAnalysis(analysis);
            setAnalysis(simplifiedAnalysis);
            setIsSimplified(true);
        } catch (error) {
            console.error("Error simplifying analysis:", error);
            setError("Failed to simplify the analysis. Please try again.");
        } finally {
            setIsSimplifying(false);
        }
    };

    const generatePDF = () => {
        console.log("Generating PDF...");
        if (!analysis) {
            setError("No analysis data available to generate PDF.");
            return;
        }

        try {
            // Create new PDF document
            const doc = new jsPDF();
            const pageWidth = doc.internal.pageSize.getWidth();
            const pageHeight = doc.internal.pageSize.getHeight();
            const margin = 20;
            let yPosition = margin;

            // Add sky blue background
            doc.setFillColor(208, 235, 255); // Light sky blue background
            doc.rect(0, 0, pageWidth, pageHeight, 'F');

            // Add header with logo and title
            if (logoImageData) {
                try {
                    const logoWidth = 20;
                    const logoHeight = 20;
                    doc.addImage(logoImageData, 'PNG', margin, 10, logoWidth, logoHeight);
                } catch (error) {
                    console.error('Error adding logo to PDF:', error);
                }
            }

            doc.setFontSize(16);
            doc.setFont("helvetica", "bold");
            doc.setTextColor(0, 51, 102); // Dark blue color for header
            doc.text("CureConnect - Skin Scan Analysis Report", pageWidth / 2, 20, { align: 'center' });

            // Add footer with logo and text
            const addFooter = () => {
                doc.setFontSize(10);
                doc.setTextColor(0, 51, 102);
                doc.text(
                    "Generated by CureConnect",
                    pageWidth / 2,
                    pageHeight - 10,
                    { align: 'center' }
                );

                if (logoImageData) {
                    try {
                        doc.addImage(logoImageData, 'PNG', pageWidth - margin - 20, pageHeight - 15, 10, 10);
                    } catch (error) {
                        console.error('Error adding footer logo to PDF:', error);
                    }
                }
            };

            // Report Title
            yPosition += 30;
            doc.setFontSize(24);
            doc.setFont("helvetica", "bold");
            doc.setTextColor(0, 51, 102);
            doc.text("Skin Scan Analysis Report", pageWidth / 2, yPosition, { align: 'center' });

            // Add a decorative line
            yPosition += 10;
            doc.setDrawColor(0, 102, 204);
            doc.setLineWidth(0.5);
            doc.line(margin, yPosition, pageWidth - margin, yPosition);

            // User Details
            yPosition += 20;
            doc.setFontSize(14);
            doc.setFont("helvetica", "bold");
            doc.setTextColor(51, 51, 51);
            doc.text("Patient Information", margin, yPosition);

            yPosition += 10;
            doc.setFontSize(12);
            doc.setFont("helvetica", "normal");
            doc.text(`Date: ${new Date().toLocaleString()}`, margin, yPosition);

            // Analysis Results - Bold Header
            yPosition += 20;
            doc.setFontSize(14);
            doc.setFont("helvetica", "bold");
            doc.setTextColor(0, 51, 102);
            doc.text("Analysis Results:", margin, yPosition);

            // Format analysis text with proper wrapping
            yPosition += 10;
            doc.setFont("helvetica", "normal");
            doc.setFontSize(12);
            doc.setTextColor(51, 51, 51);

            const splitText = doc.splitTextToSize(analysis, pageWidth - (2 * margin));

            // Check if text might overflow to next page
            if (yPosition + (splitText.length * 7) > pageHeight - margin) {
                addFooter();
                doc.addPage();

                // Add background to new page
                doc.setFillColor(208, 235, 255);
                doc.rect(0, 0, pageWidth, pageHeight, 'F');

                yPosition = margin;
            }

            doc.text(splitText, margin, yPosition);

            // Add a box around the analysis text
            const textHeight = splitText.length * 7;
            doc.setDrawColor(0, 102, 204);
            doc.setLineWidth(0.3);
            doc.roundedRect(margin - 5, yPosition - 5, pageWidth - (2 * margin) + 10, textHeight + 10, 3, 3);

            // Add timestamp at the bottom
            yPosition = pageHeight - 30;
            doc.setFontSize(10);
            doc.setTextColor(102, 102, 102);
            doc.text(`Generated on: ${new Date().toLocaleString()}`, margin, yPosition);

            // Add footer to the last page
            addFooter();

            // Save the PDF with a proper filename
            const filename = `Skin_Scan_Report_${new Date().toLocaleDateString().replace(/\//g, '-')}.pdf`;
            doc.save(filename);
            console.log("PDF generated successfully:", filename);

            return true;
        } catch (error) {
            console.error('Error generating PDF:', error);
            setError("There was an error generating the PDF. Please try again.");
            return false;
        }
    };

    const handleRedirect = () => {
        console.log("Starting redirect process...");
        setIsRedirecting(true);
        setCountdown(5);

        const timer = setInterval(() => {
            setCountdown((prev) => {
                if (prev <= 1) {
                    clearInterval(timer);
                    console.log("Redirecting to emergency level:", emergencyLevel);
                    // Handle routing based on emergency level
                    if (emergencyLevel === 1) {
                        // Redirect first
                        window.location.href = 'https://tinyurl.com/4jdnrr5b';
                    } else if (emergencyLevel === 2) {
                        navigate('/telemedicine');
                    } else if (emergencyLevel === 3) {
                        navigate('/chat');
                    }
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(timer);
    };

    const handleStayOnPage = () => {
        console.log("User chose to stay on page");
        setShowRedirect(false);
        setCountdown(5);
        setIsRedirecting(false);
    };

    return (
        <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
            <div className="max-w-4xl mx-auto px-4 py-8">
                <Header />
                
                {/* Error Display */}
                {error && (
                    <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
                        <strong>Error:</strong> {error}
                    </div>
                )}
                
                <div className="bg-white rounded-2xl shadow-xl p-6 mb-8">
                    {/* Image Upload Section */}
                    <div 
                        className="border-2 border-dashed border-gray-300 rounded-xl p-10 text-center mb-6"
                        onDrop={handleDrop}
                        onDragOver={handleDragOver}
                    >
                        {!imagePreview ? (
                            <div className="flex flex-col items-center">
                                <svg className="w-16 h-16 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                </svg>
                                <h3 className="text-xl text-gray-700 mb-2">Upload a skin image for analysis</h3>
                                <p className="text-gray-500 mb-4">Click to browse or drag and drop (Max 10MB)</p>
                                <input 
                                    type="file" 
                                    accept="image/*,video/*" 
                                    onChange={handleImageChange} 
                                    className="hidden" 
                                    id="fileInput"
                                />
                                <label 
                                    htmlFor="fileInput" 
                                    className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg cursor-pointer transition-colors"
                                >
                                    Select Image/Video
                                </label>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center">
                                {selectedImage?.type.startsWith('video/') ? (
                                    <video 
                                        src={imagePreview} 
                                        controls
                                        className="max-h-64 max-w-full mb-4 rounded-lg shadow-md" 
                                    />
                                ) : (
                                    <img 
                                        src={imagePreview} 
                                        alt="Preview" 
                                        className="max-h-64 max-w-full mb-4 rounded-lg shadow-md" 
                                    />
                                )}
                                <div className="flex space-x-4">
                                    <button 
                                        onClick={handleUploadAndAnalyze} 
                                        className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg transition-colors disabled:bg-gray-400"
                                        disabled={isAnalyzing}
                                    >
                                        {isAnalyzing ? "Analyzing..." : `Analyze ${selectedImage?.type.startsWith('video/') ? 'Video' : 'Image'}`}
                                    </button>
                                    <button 
                                        onClick={resetAnalysis} 
                                        className="bg-gray-300 hover:bg-gray-400 text-gray-800 px-4 py-2 rounded-lg transition-colors"
                                        disabled={isAnalyzing}
                                    >
                                        Reset
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Analysis Results Section */}
                    <div className="bg-gray-50 rounded-xl p-6">
                        <AnalysisResults
                            analysis={analysis}
                            isAnalyzing={isAnalyzing}
                            isSimplifying={isSimplifying}
                            isSimplified={isSimplified}
                            onSimplify={handleSimplify}
                            onShowMedicalTerms={() => {
                                setAnalysis(analysis);
                                setIsSimplified(false);
                            }}
                            onDownloadReport={generatePDF}
                        />
                    </div>
                </div>

                {/* Disclaimer */}
                <div className="text-center text-gray-600 text-sm">
                    <p>This is a demonstration of AI-powered skin condition analysis.</p>
                </div>

                {/* Emergency Level Modal */}
                {showRedirect && emergencyLevel && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                        <div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full mx-4">
                            <div className="text-center">
                                <h2 className="text-2xl font-bold mb-4">Emergency Level Detected</h2>
                                <div className={`text-4xl font-bold mb-4 ${
                                    emergencyLevel === 1 ? 'text-red-600' :
                                    emergencyLevel === 2 ? 'text-yellow-600' :
                                    'text-green-600'
                                }`}>
                                    Level {emergencyLevel}
                                </div>
                                <p className="text-gray-600 mb-4">
                                    {emergencyLevel === 1 ? 'High Emergency - Immediate attention required' :
                                     emergencyLevel === 2 ? 'Moderate Emergency - Prompt medical attention needed' :
                                     'Low Emergency - Routine care recommended'}
                                </p>
                                
                                {!isRedirecting ? (
                                    <div className="flex gap-4 justify-center mt-6">
                                        <button
                                            onClick={handleRedirect}
                                            className={`px-6 py-2 rounded-lg font-semibold text-white ${
                                                emergencyLevel === 1 ? 'bg-red-600 hover:bg-red-700' :
                                                emergencyLevel === 2 ? 'bg-yellow-600 hover:bg-yellow-700' :
                                                'bg-green-600 hover:bg-green-700'
                                            }`}
                                        >
                                            Proceed to {emergencyLevel === 1 ? 'Emergency' : 
                                                       emergencyLevel === 2 ? 'Telemedicine' : 
                                                       'Chat'}
                                        </button>
                                        <button
                                            onClick={handleStayOnPage}
                                            className="px-6 py-2 rounded-lg font-semibold bg-gray-200 hover:bg-gray-300 text-gray-700"
                                        >
                                            Stay on Page
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <p className="text-gray-500">
                                            Redirecting in {countdown} seconds...
                                        </p>
                                        <div className="mt-4">
                                            <div className="w-full bg-gray-200 rounded-full h-2.5">
                                                <div 
                                                    className="h-2.5 rounded-full transition-all duration-1000"
                                                    style={{
                                                        width: `${((5 - countdown) / 5) * 100}%`,
                                                        backgroundColor: emergencyLevel === 1 ? '#dc2626' :
                                                                        emergencyLevel === 2 ? '#d97706' :
                                                                        '#16a34a'
                                                    }}
                                                ></div>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}