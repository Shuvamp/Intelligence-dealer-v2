"""Self-check for the poster prompt car-count branches: `python test_poster_prompt.py`."""

from app.poster_prompt import build_poster_prompt


def test_multi_car():
    p = build_poster_prompt(theme="Diwali", headline="Hi", car_image_count=2, has_logo=True)
    assert "2 car photos are attached" in p, p
    # Logo takes input image 1, so the two cars are images 2 and 3.
    assert "input images 2 to 3" in p, p
    assert "ALL 2 hero vehicles together" in p, p
    assert "No vehicle may be cropped" in p, p


def test_one_car():
    p = build_poster_prompt(theme="Diwali", headline="Hi", car_image_count=1)
    assert "EXACT car from the attached photo" in p, p
    assert "No vehicle may be cropped" in p, p


def test_no_car():
    p = build_poster_prompt(theme="Diwali", headline="Hi")
    assert "Feature a premium, accurate Nissan" in p, p


if __name__ == "__main__":
    test_multi_car()
    test_one_car()
    test_no_car()
    print("poster_prompt OK")
