from pypdf import PdfReader
import io

def extract_text_from_pdf(file_content: bytes) -> str:
    """
    Extracts text from PDF bytes.
    """
    try:
        reader = PdfReader(io.BytesIO(file_content))
        text = ""
        for page in reader.pages:
            extracted = page.extract_text()
            if extracted:
                text += extracted + "\n"
        return text.strip()
    except Exception as e:
        raise RuntimeError(f"Failed to parse PDF: {str(e)}")
