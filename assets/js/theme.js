;
(function($) {
    "use strict";
    //Mobile Menu
    jQuery('.stellarnav').stellarNav({
        theme: 'plain',
        breakpoint: 1023,
        menuLabel: '',
        sticky: false,
        position: 'static',
        openingSpeed: 80,
        closingDelay: 80,
        showArrows: true,
        closeBtn: false,
        closeLabel: 'Close',
        mobileMode: false,
        scrollbarFix: false
    });
    // Sticky Menu
    $(window).on('scroll', function() {
        var scroll = $(window).scrollTop();
        if (scroll < 100) {
            $("#sticky-header").removeClass("sticky-bar");
        } else {
            $("#sticky-header").addClass("sticky-bar");
        }
    });
    // Video Post PopUp
    if ($('.video-popup').length) {
        $('.video-popup').magnificPopup({
            disableOn: 700,
            type: 'iframe',
            mainClass: 'mfp-fade',
            removalDelay: 160,
            preloader: false,
            fixedContentPos: false
        });
    }
    // Post gallery 
    if ($('.post-gallerys').length) {
        $('.post-gallerys').slick({
            dots: false,
            infinite: true,
            speed: 700,
            cssEase: 'linear',
            autoplay: true,
            autoplaySpeed: 2000,
        });
    }
    // Limit Post Navication Title 
    if ($('.post-nav-container p').length) {
        $('.post-nav-container p').text($('.post-nav-container p').text().substring(0, 40));
    }

    $(window).on("load", function() {
        if ($(".preloader-area").length) {
            $(".preloader-area").fadeOut();
        }
    });
    // Bottom to top 
    $(window).on('scroll', function() {
        if ($(this).scrollTop() > 300) {
            $('#back-top').fadeIn();
        } else {
            $('#back-top').fadeOut();
        }
    });

    $('#back-top').on('click', function() {
        $("html, body").animate({
            scrollTop: 0
        }, 1000);
        return false;
    });

}(jQuery))