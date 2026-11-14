import pytest
from pydantic import ValidationError
from gradientdescentfarmers.source_builder.core.schema import FarmerInput

def test_accept_milpa(farmer):
    assert len(farmer.crop_history[0].plantings)==3
    assert farmer.crop_history[0].planting_system=="intercropping"

def test_weights_rejected(farmer):
    payload=farmer.model_dump(mode="json")
    payload["objective_weights"]["profit"]+=1
    with pytest.raises(ValidationError):FarmerInput.model_validate(payload)

def test_nonexistent_field_rejected(farmer):
    payload=farmer.model_dump(mode="json")
    payload["crop_history"][0]["field_id"]="unknown"
    with pytest.raises(ValidationError):FarmerInput.model_validate(payload)

def test_planting_date_rejected(farmer):
    payload=farmer.model_dump(mode="json")
    payload["crop_history"][0]["plantings"][0]["harvest_date"]="2024-01-01"
    with pytest.raises(ValidationError):FarmerInput.model_validate(payload)

def test_intercrop_overlap_area_not_summed(farmer):
    payload=farmer.model_dump(mode="json")
    for p in payload["crop_history"][0]["plantings"]:
        p["cultivated_area_ha"]=1.5
    # 3 species sharing one 1.5-ha intercropped field are NOT 4.5 ha.
    assert FarmerInput.model_validate(payload).fields[0].area_ha==1.5

def test_budget_needs_currency(farmer):
    payload=farmer.model_dump(mode="json")
    payload["budget"]=100
    with pytest.raises(ValidationError):FarmerInput.model_validate(payload)
