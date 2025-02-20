(function($) {
// webinar popup
  var modal = $("#live-webinar");
  var closeModalBtn = $(".close-btn");

  // Check if the popup should be displayed
  var isPopupClosed = localStorage.getItem("popupClosed");
  if (!isPopupClosed) {
    modal.show();
  }

  // Close the popup when the close button is clicked
  closeModalBtn.click(function () {
    modal.hide();
    // Save to localStorage that the popup has been closed
    localStorage.setItem("popupClosed", "true");
  });
  
	$('.marketing-services .client-speak').slick({
		dots: true,
		arrows: false
	});
	jQuery('.low-code-automation.business-intelligence.newTemp select').change(function(){
		if(jQuery(this).val() == ''){
			jQuery(this).css('color','#d0d7d8');
			console.log('blank');
		}
		else{
			jQuery(this).css('color','#555');
			console.log('not blank');
		}
	})

	// Right Click Disable
	jQuery(document).on("contextmenu", function(e) {
      e.preventDefault();
    });

	// Disable right-click on the iframe document if it's from the same origin
    jQuery('iframe').on('load', function() {
        var iframeDocument = $(this).contents();
        iframeDocument.on("contextmenu", function(e) {
            e.preventDefault();
        });
    });
    
    // Disable copy
    jQuery(document).on("copy", function(e) {
        e.preventDefault();
    });

    // Disable cut
    jQuery(document).on("cut", function(e) {
        e.preventDefault();
    });
	//jQuery('.low-code-automation.business-intelligence.newTemp select').change(function(){jQuery(this).css('color','#555');})
	// Black box tab
	$('.blackTabContainer li').hide().removeClass('active');
	$('.blackTabContainer li:eq(0)').show().addClass('active');
	$('.blackTabHeading li span').hide();
	$('.blackTabHeading li:eq(0) span').show();
	$('.blackTabHeading li').removeClass('active');
	$('.blackTabHeading li:eq(0)').addClass('active');
	
	$('.blackTabHeading li').click(function(){
		var idxVal = $(this).index();
		$('.blackTabHeading li').removeClass('active');
		$(this).addClass('active')
		$('.blackTabContainer li').hide().removeClass('active');
		$('.blackTabContainer li:eq('+idxVal+')').show().addClass('active');
		$('.blackTabHeading li span').hide();
	$('.blackTabHeading li:eq('+idxVal+') span').show();
	})
	
	checkCookiePageLoad();
	$('#cookie_action_close_header').click(function(){
		checkCookie();
		//alert('test');
	})
	// cookie script start //
		function setCookie(cname,cvalue,exdays) {
		  const d = new Date();
		  d.setTime(d.getTime() + (exdays*24*60*60*1000));
		  let expires = "expires=" + d.toGMTString();
		  document.cookie = cname + "=" + cvalue + ";" + expires + ";path=/";
		}

		function getCookie(cname) {
		  let name = cname + "=";
		  let decodedCookie = decodeURIComponent(document.cookie);
		  let ca = decodedCookie.split(';');
		  for(let i = 0; i < ca.length; i++) {
			let c = ca[i];
			while (c.charAt(0) == ' ') {
			  c = c.substring(1);
			}
			if (c.indexOf(name) == 0) {
			  return c.substring(name.length, c.length);
			}
		  }
		  return "";
		}

		function checkCookie() {
			 user = "damcocookie";
			   localStorage.setItem("username", user);
			   $('#cookie-law-info-bar').hide();
		}
		function checkCookiePageLoad() {
		  if (localStorage.getItem("username") == "" || localStorage.getItem("username") !="damcocookie") {
			$('#cookie-law-info-bar').show();
		  } else {
			 if (localStorage.getItem("username") != "" && localStorage.getItem("username") != null || localStorage.getItem("username") == "damcocookie") {
			   //alert("Welcome again " + user);
			   $('#cookie-law-info-bar').hide();
			 }
		  }
		}
	// cookie script end //

		// productLabs tab
		$('ul.v-result li').hide().removeClass('active');
		$('ul.v-result li:eq('+0+')').show().addClass('active');
		$('ul.v-menu li').removeClass('active');
		$('ul.v-menu li:eq('+0+')').addClass('active');
		let idxval = 0
		$('.vofferingColBox').on('click', 'ul.v-menu li', function() {
		    idxval = $(this).index();
		    $('ul.v-result li').hide().removeClass('active');
			$('ul.v-result li:eq('+idxval+')').show().addClass('active');

			$('ul.v-menu li').removeClass('active');
			$(this).addClass('active');
		});
		$('.popLnk a').click(function(){
			$('#formModal').modal('show');
		})
	$('.flaxLnks').hover(
		function () {
          $(this).find('.flaxLnk').addClass('transitionBtn');
       }, 
       function () {
          $(this).find('.flaxLnk').removeClass('transitionBtn');
       }
	)

	"use strict";

	if($('.curved-circle').length) {
        $('.curved-circle').circleType({position: 'absolute', dir: 1, radius: 83, forceHeight: true, forceWidth: true});
    }
	
	//Hide Loading Box (Preloader)
	function handlePreloader() {
		if($('.loader-wrap').length){
			$('.loader-wrap').delay(1000).fadeOut(500);
		}
		TweenMax.to($(".loader-wrap .overlay"), 1.2, {
            force3D: true,
            left: "100%",
            ease: Expo.easeInOut,
        });
	}

	if ($(".preloader-close").length) {
        $(".preloader-close").on("click", function(){
            $('.loader-wrap').delay(200).fadeOut(500);
        })
    }

    function dynamicCurrentMenuClass(selector) {
        let FileName = window.location.href.split('/').reverse()[0];

        selector.find('li').each(function () {
            let anchor = $(this).find('a');
            if ($(anchor).attr('href') == FileName) {
                $(this).addClass('current');
            }
        });
        // if any li has .current elmnt add class
        selector.children('li').each(function () {
            if ($(this).find('.current').length) {
                $(this).addClass('current');
            }
        });
        // if no file name return 
        if ('' == FileName) {
            selector.find('li').eq(0).addClass('current');
        }
    }

    // dynamic current class        
    let mainNavUL = $('.main-menu').find('.navigation');
    dynamicCurrentMenuClass(mainNavUL);
	
	//Update Header Style and Scroll to Top
	function headerStyle() {
		if($('.main-header').length){
			var windowpos = $(window).scrollTop();
			var siteHeader = $('.main-header');
			var scrollLink = $('.scroll-to-top');
			var sticky_header = $('.main-header .sticky-header');
			if (windowpos > 100) {
				siteHeader.addClass('fixed-header');
				sticky_header.addClass("animated slideInDown");
				scrollLink.fadeIn(300);
			} else {
				siteHeader.removeClass('fixed-header');
				sticky_header.removeClass("animated slideInDown");
				scrollLink.fadeOut(300);
			}
		}
	}
	
	headerStyle();

	//Submenu Dropdown Toggle
	if($('.main-header li.dropdown ul').length){
		$('.main-header .navigation li.dropdown').append('<div class="dropdown-btn"><span class="fa fa-angle-right"></span></div>');
	}

	//Hidden Sidebar
	if($('.hidden-sidebar').length){

		var animButton = $(".sidemenu-nav-toggler"),
	        hiddenBar = $(".hidden-sidebar"),
	        navOverlay = $(".nav-overlay"),
	        hiddenBarClose = $(".hidden-sidebar-close");

	    function showMenu() {
	        TweenMax.to(hiddenBar, 0.6, {
	            force3D: false,
	            right: "0",
	            ease: Expo.easeInOut
	        });
	        hiddenBar.removeClass("close-sidebar");
	    	navOverlay.fadeIn(500);
	    }

	    function hideMenu() {
	        TweenMax.to(hiddenBar, 0.6, {
	            force3D: false,
	            right: "-480px",
	            ease: Expo.easeInOut
	        });
	        hiddenBar.addClass("close-sidebar");
	        navOverlay.fadeOut(500);
	    }
	    animButton.on("click", function() {
	        if (hiddenBar.hasClass("close-sidebar")) showMenu();
	        else hideMenu();
	    });
	    navOverlay.on("click", function() {
	    	hideMenu();
	    });
	    hiddenBarClose.on("click", function() {
	    	hideMenu();
	    });
	}

	if ($('.nav-overlay').length) {
		// / cursor /
		var cursor = $(".nav-overlay .cursor"),
		follower = $(".nav-overlay .cursor-follower");

		var posX = 0,
		posY = 0;

		var mouseX = 0,
		mouseY = 0;

		TweenMax.to({}, 0.016, {
			repeat: -1,
			onRepeat: function() {
				posX += (mouseX - posX) / 9;
				posY += (mouseY - posY) / 9;

				TweenMax.set(follower, {
					css: { 
						left: posX - 22,
						top: posY - 22
					}
				});

				TweenMax.set(cursor, {
					css: { 
						left: mouseX,
						top: mouseY
					}
				});

			}
		});

		$(document).on("mousemove", function(e) {
			var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
			mouseX = e.pageX;
			mouseY = e.pageY - scrollTop;
		});
		$("button, a").on("mouseenter", function() {
			cursor.addClass("active");
			follower.addClass("active");
		});
		$("button, a").on("mouseleave", function() {
			cursor.removeClass("active");
			follower.removeClass("active");
		});
		$(".nav-overlay").on("mouseenter", function() {
			cursor.addClass("close-cursor");
			follower.addClass("close-cursor");
		});
		$(".nav-overlay").on("mouseleave", function() {
			cursor.removeClass("close-cursor");
			follower.removeClass("close-cursor");
		});
	}

	//Mobile Nav Hide Show
	if($('.mobile-menu').length){
		
		$('.mobile-menu .menu-box').mCustomScrollbar();
		
		var mobileMenuContent = $('.main-header .nav-outer .main-menu').html();
		$('.mobile-menu .menu-box .menu-outer').append(mobileMenuContent);
		$('.sticky-header .main-menu').append(mobileMenuContent);
		
		//Dropdown Button
		$('.mobile-menu .navigation > li.dropdown .dropdown-btn').click(function() {
			let thisvar = $(this);
			if(thisvar.parent().attr('class') == 'dropdown main-nav' || thisvar.parent().attr('class') == 'dropdown main-nav current'){
				$('.mobile-menu .navigation > li.dropdown .dropdown-btn').removeClass('open');
				if(thisvar.parent().find('.dropdown-menu').attr('style') == 'display: none;'){
					//alert(1);
					$('.mobile-menu .navigation > li.dropdown > .dropdown-menu').slideUp(500);
					thisvar.parent().find('.dropdown-menu').slideDown(500);
					thisvar.addClass('open');
				}
				else if(thisvar.parent().find('.dropdown-menu').attr('style') == 'display: block;'){
					//alert(2);
					$('.inmenu').slideUp(500);
					$('.mobile-menu .navigation > li.dropdown > .dropdown-menu').slideUp(500);
					thisvar.removeClass('open');
					//thisvar.parent().find('.dropdown-menu').slideDown(500);
				}
				
			}else if(thisvar.parent().attr('class') == 'dropdown'){
				$('.inside-mega-menu li.dropdown .dropdown-btn').removeClass('open');
				if(thisvar.parent().find('.inmenu').attr('style') == 'display: block;'){
					//alert(1);
					thisvar.parent().find('.inmenu').slideUp(500);
					thisvar.removeClass('open');
				}
				else{
					//alert(2);
					//alert(thisvar.parent().find('.inmenu').attr('class'));
					$('.inmenu').slideUp(500);
					thisvar.parent().find('.inmenu').slideDown(500);
					thisvar.addClass('open');
				}
				
				//$('.mobile-menu .navigation li>ul, .mobile-menu .navigation li>ul>li>ul').slideUp(500);
			}
			

			// if($('body').hasClass('mobile-menu-visible')) {
		 //    	$('body').removeClass('mobile-menu-visible');
		 //    	$(this).children().attr('src','/wp-content/themes/DamcoNew/assets/images/icons/icon-bar.png');
			// } else {
			//     $('body').addClass('mobile-menu-visible');
			//     $(this).children().attr('src','/wp-content/themes/DamcoNew/assets/images/icons/close.png');
			// }
				//$('.mobile-nav-toggler').toggle();
		});


		// $('.main-menu .navigation .inside-mega-menu li.dropdown').hover(
		// 	function () {
		// 	  $('.main-menu .navigation .inside-mega-menu li.dropdown').removeClass('active');
	 //          $(this).children().children('.dropdown-btn').css('color','#ffffff');
	 //          $(this).children().children('.dropdown-btn').children().removeClass('fa-angle-right').addClass('fa-angle-down');
		// 	  $(this).children('ul.inmenu').slideDown();
		// 	  $(this).addClass('active');
	 //       }
	 //       , 
		//    function () {
		// 	  	$(this).children().children('.dropdown-btn').css('color','#1e232a');
		// 	    $(this).children().children('.dropdown-btn').children().removeClass('fa-angle-down').addClass('fa-angle-right');
		// 		$(this).children('ul.inmenu').slideUp();
		//       	$(this).removeClass('active');
			      		
		//    }
		// )

		//Menu Toggle Btn
		// $('.mobile-nav-toggler').on('click', function() {
		// 	$('body').addClass('mobile-menu-visible');
		// });

		// //Menu Toggle Btn
		// $('.mobile-menu .menu-backdrop,.mobile-menu .close-btn,.scroll-nav li a').on('click', function() {
		// 	$('body').removeClass('mobile-menu-visible');
		// });
		$('.mobile-nav-toggler, .mobile-menu .navigation li a').click(function() {
			if($('body').hasClass('mobile-menu-visible')) {
		    	$('body').removeClass('mobile-menu-visible');
		    	$('.mobile-nav-toggler').children().attr('src','assets/themes/arish/assets/images/icons/icon-bar.png');
				$('.mobile-nav-toggler').children().attr('style', '');
			} else {
			    $('body').addClass('mobile-menu-visible');
			    $('.mobile-nav-toggler').children().attr('src','assets/themes/arish/assets/images/icons/close_2.png');
				$('.mobile-nav-toggler').children().attr('style','filter: invert(100%) sepia(41%) saturate(2%) hue-rotate(84deg) brightness(101%) contrast(100%);');
			}
				//$('.mobile-nav-toggler').toggle();
		});
	}

	//Sidemenu Nav Hide Show
	if($('.side-menu').length){
		
		$('.side-menu .menu-box').mCustomScrollbar();
		
		//Dropdown Button
		$('.side-menu li.dropdown .dropdown-btn').on('click', function() {
			$(this).toggleClass('open');
			$(this).prev('ul').slideToggle(500);
		});

		$('body').addClass('side-menu-visible');
		//Menu Toggle Btn
		$('.side-nav-toggler').on('click', function() {
			$('body').addClass('side-menu-visible');
		});

		//Menu Toggle Btn
		$('.side-menu .side-menu-resize').on('click', function() {
			$('body').toggleClass('side-menu-visible');
		});

		//Menu Toggle Btn
		$('.main-header .mobile-nav-toggler-two').on('click', function() {
			$('body').addClass('side-menu-visible-s2');
		});

		//Menu Overlay
		$('.main-header .side-menu-overlay').on('click', function() {
			$('body').removeClass('side-menu-visible-s2');
		});
	}
	
	//Search Popup
	if($('#search-popup').length){
		
		//Show Popup
		$('.search-toggler').on('click', function() {
			$('#search-popup').addClass('popup-visible');
		});
		$(document).keydown(function(e){
	        if(e.keyCode === 27) {
	            $('#search-popup').removeClass('popup-visible');
	        }
	    });
		//Hide Popup
		$('.close-search,.search-popup .overlay-layer').on('click', function() {
			$('#search-popup').removeClass('popup-visible');
		});
	}
	
	//Case Tabs
	if($('.case-tabs').length){
		$('.case-tabs .case-tab-btns .case-tab-btn').on('click', function(e) {
			e.preventDefault();
			var target = $($(this).attr('data-tab'));
			
			if ($(target).hasClass('actve-tab')){
				return false;
			}else{
				$('.case-tabs .case-tab-btns .case-tab-btn').removeClass('active-btn');
				$(this).addClass('active-btn');
				$('.case-tabs .case-tabs-content .case-tab').removeClass('active-tab');
				$(target).addClass('active-tab');
			}
		});
	}
	
	// Lazyload Images
	if($('.lazy-image').length){
		new LazyLoad({
			elements_selector: ".lazy-image",
			load_delay: 0,
			threshold: 300
		});
	}
	
	/////////////////////////////
		//Universal Code for All Owl Carousel Sliders
	/////////////////////////////
	
	if ($('.theme_carousel').length) {
			$(".theme_carousel").each(function (index) {
			var $owlAttr = {},
			$extraAttr = $(this).data("options");
			$.extend($owlAttr, $extraAttr);
			$(this).owlCarousel($owlAttr);
		});
	}
	
	// Donation Progress Bar
	if ($('.count-bar').length) {
		$('.count-bar').appear(function(){
			var el = $(this);
			var percent = el.data('percent');
			$(el).css('width',percent).addClass('counted');
		},{accY: -50});

	}
	
	//Fact Counter + Text Count
	if($('.count-box').length){
		$('.count-box').appear(function(){
	
			var $t = $(this),
				n = $t.find(".count-text").attr("data-stop"),
				r = parseInt($t.find(".count-text").attr("data-speed"), 10);
				
			if (!$t.hasClass("counted")) {
				$t.addClass("counted");
				$({
					countNum: $t.find(".count-text").text()
				}).animate({
					countNum: n
				}, {
					duration: r,
					easing: "linear",
					step: function() {
						$t.find(".count-text").text(Math.floor(this.countNum));
					},
					complete: function() {
						$t.find(".count-text").text(this.countNum);
					}
				});
			}
			
		},{accY: 0});
	}
	
	//Tabs Box
	if($('.tabs-box').length){
		$('.tabs-box .tab-buttons .tab-btn').on('click', function(e) {
			e.preventDefault();
			var target = $($(this).attr('data-tab'));
			
			if ($(target).is(':visible')){
				return false;
			}else{
				target.parents('.tabs-box').find('.tab-buttons').find('.tab-btn').removeClass('active-btn');
				$(this).addClass('active-btn');
				target.parents('.tabs-box').find('.tabs-content').find('.tab').fadeOut(0);
				target.parents('.tabs-box').find('.tabs-content').find('.tab').removeClass('active-tab');
				$(target).fadeIn(300);
				$(target).addClass('active-tab');
			}
		});
	}
	
	//Accordion Box
	if($('.accordion-box').length){
		$(".accordion-box").on('click', '.acc-btn', function() {
			
			var outerBox = $(this).parents('.accordion-box');
			var target = $(this).parents('.accordion');
			
			if($(this).hasClass('active')!==true){
				$(outerBox).find('.accordion .acc-btn').removeClass('active');
			}
			
			if ($(this).next('.acc-content').is(':visible')){
				return false;
			}else{
				$(this).addClass('active');
				$(outerBox).children('.accordion').removeClass('active-block');
				$(outerBox).find('.accordion').children('.acc-content').slideUp(300);
				target.addClass('active-block');
				$(this).next('.acc-content').slideDown(300);	
			}
		});	
	}
	


	//Price Range Slider
	if($('.price-range-slider').length){
		$( ".price-range-slider" ).slider({
			range: true,
			min: 10,
			max: 200,
			values: [ 10, 99 ],
			slide: function( event, ui ) {
			$( "input.property-amount" ).val( ui.values[ 0 ] + " - " + ui.values[ 1 ] );
			}
		});
		
		$( "input.property-amount" ).val( $( ".price-range-slider" ).slider( "values", 0 ) + " - $" + $( ".price-range-slider" ).slider( "values", 1 ) );	
	}

	
	//Jquery Spinner / Quantity Spinner
	if($('.quantity-spinner').length){
		$("input.quantity-spinner").TouchSpin({
		  verticalbuttons: true
		});
	}

	//LightBox / Fancybox
	if($('.lightbox-image').length) {
		$('.lightbox-image').fancybox({
			openEffect  : 'fade',
			closeEffect : 'fade',
			helpers : {
				media : {}
			}
		});
	}

	//Sortable Masonary with Filters
	function sortableMasonry() {
		if ($('.sortable-masonry').length) {
			var winDow = $(window);
			// Needed variables
			var $container = $('.sortable-masonry .items-container');
			var $filter = $('.filter-btns');
			$container.isotope({
				filter: '.all',
				animationOptions: {
					duration: 500,
					easing: 'linear'
				}
			});
			// Isotope Filter 
			$filter.find('li').on('click', function() {
				var selector = $(this).attr('data-filter');
				try {
					$container.isotope({
						filter: selector,
						animationOptions: {
							duration: 500,
							easing: 'linear',
							queue: false
						}
					});
				} catch (err) {}
				return false;
			});
			winDow.on('resize', function() {
				var selector = $filter.find('li.active').attr('data-filter');
				$container.isotope({
					filter: selector,
					animationOptions: {
						duration: 500,
						easing: 'linear',
						queue: false
					}
				});
				$container.isotope()
			});
			var filterItemA = $('.filter-btns li');
			filterItemA.on('click', function() {
				var $this = $(this);
				if (!$this.hasClass('active')) {
					filterItemA.removeClass('active');
					$this.addClass('active');
				}
			});
			$container.isotope("on", "layoutComplete", function(a, b) {
                var a = b.length,
                pcn = $(".filters .count");
                pcn.html(a);                
            }); 
		}
	}
	sortableMasonry();

	//Jquery Knob animation 
	if ($('.dial').length) {
		$('.dial').appear(function() {
			var elm = $(this);
			var color = elm.attr('data-fgColor');
			var perc = elm.attr('value');
			elm.knob({
				'value': 0,
				'min': 0,
				'max': 100,
				'skin': 'tron',
				'readOnly': true,
				'thickness': 0.10,
				'dynamicDraw': true,
				'displayInput': false
			});
			$({
				value: 0
			}).animate({
				value: perc
			}, {
				duration: 2000,
				easing: 'swing',
				progress: function() {
					elm.val(Math.ceil(this.value)).trigger('change');
				}
			});
			//circular progress bar color
			$(this).append(function() {
				// elm.parent().parent().find('.circular-bar-content').css('color',color);
				//elm.parent().parent().find('.circular-bar-content .txt').text(perc);
			});
		}, {
			accY: 20
		});
	}

	// Testimonial 
	if ($('.testimonial-carousel').length) {
		var testimonialThumb = new Swiper('.testimonial-thumbs', {
			preloadImages: false,
            loop: true,
            speed: 2400,
            spaceBetween: 0,
            effect: "slide",
		});
		var totalSlides = $(".swiper-container").length;
		var testimonialContent = new Swiper('.testimonial-content', {
			preloadImages: false,
                loop: true,
                speed: 2400,
                spaceBetween: 0,
                effect: "slide",
                autoplay: {
                    delay: 2500,
                    disableOnInteraction: false
                },
			navigation: {
				nextEl: '.swiper-button-next',
				prevEl: '.swiper-button-prev',
			},
			
		});
		testimonialContent.controller.control = testimonialThumb;
		testimonialThumb.controller.control = testimonialContent;
	}

	// Products Carousel 
	if ($('.products-carousel').length) {
		var productThumbs = new Swiper('.product-thumbs', {
			preloadImages: false,
            loop: true,
            slidesPerView: 3,
            speed: 1400,
            spaceBetween: 0,
            direction: "vertical",
            breakpoints: {
                300: {
                  slidesPerView: 3,
                }, 
            }
		});
		var productContent = new Swiper('.product-content', {
			preloadImages: false,
            loop: true,
            speed: 1400,
            spaceBetween: 0,
            effect: "fade",			
		});
		productContent.controller.control = productThumbs;
		productThumbs.controller.control = productContent;
	}


	
	// Scroll to a Specific Div
	if($('.scroll-to-target').length){
		$(".scroll-to-target").on('click', function() {
			var target = $(this).attr('data-target');
		   // animate
		   $('html, body').animate({
			   scrollTop: $(target).offset().top
			 }, 1500);
	
		});
	}

	// Isotop Layout
	function isotopeBlock() {
		if($(".isotope-block").length){
			var $grid = $('.isotope-block').isotope();
	
		}
	}

	isotopeBlock();

	//Progress Bar / Levels
	if ($('.progress-levels .progress-box .bar-fill').length) {
		$(".progress-box .bar-fill").each(function() {
			var progressWidth = $(this).attr('data-percent');
			$(this).css('width', progressWidth + '%');
			$(this).children('.percent').html(progressWidth + '%');
		});
	}

	
	// Elements Animation
	if($('.wow').length){
		var wow = new WOW(
		  {
			boxClass:     'wow',      // animated element css class (default is wow)
			animateClass: 'animated', // animation css class (default is animated)
			offset:       0,          // distance to the element when triggering the animation (default is 0)
			mobile:       true,       // trigger animations on mobile devices (default is true)
			live:         true       // act on asynchronously loaded content (default is true)
		  }
		);
		wow.init();
	}

	//Add One Page nav
	if($('.scroll-nav').length) {
		$('.scroll-nav ul').onePageNav();
	}

		// Testimonial 
	if ($('.news-carousel').length) {
		var newsCarousel = new Swiper('.news-carousel', {
			loop: false,
			spaceBetween: 0,
			slidesPerView: 3,
			initialSlide: 1,
			freeMode: true,
			speed: 1400,
			watchSlidesVisibility: true,
			watchSlidesProgress: true,
			observer: true,
			slideActiveClass: 'swiper-slide-active',
			autoplay: {
			    delay: 5000,
			},
			navigation: {
				nextEl: '.swiper-button-next',
				prevEl: '.swiper-button-prev',
			},
            breakpoints: {
                991: {
                  slidesPerView: 2,
                },
                640: {
                  slidesPerView: 1,
                }, 
            },
            scrollbar: {
			    el: '.swiper-scrollbar',
			    draggable: true,
			},
		});
	}

	// Testimonial 
	if ($('.carouselLogoSlide').length) {
		var newsCarousel = new Swiper('.news-carousel', {
			loop: false,
			spaceBetween: 0,
			slidesPerView: 3,
			initialSlide: 1,
			freeMode: true,
			speed: 1400,
			watchSlidesVisibility: true,
			watchSlidesProgress: true,
			observer: true,
			slideActiveClass: 'swiper-slide-active',
			autoplay: {
			    delay: 5000,
			},
			navigation: {
				nextEl: '.swiper-button-next',
				prevEl: '.swiper-button-prev',
			},
            breakpoints: {
                991: {
                  slidesPerView: 2,
                },
                640: {
                  slidesPerView: 1,
                }, 
            },
            scrollbar: {
			    el: '.swiper-scrollbar',
			    draggable: true,
			},
		});
	}
/* ==========================================================================
   When document is Scrollig, do
   ========================================================================== */
	
	$(window).on('scroll', function() {
		headerStyle();
	});
	
/* ==========================================================================
   When document is loading, do
   ========================================================================== */
	
	$(window).on('load', function() {
		handlePreloader();
		sortableMasonry();
		// isotopeBlock();
		
	});	

	$('.insights .card-body').hover(
		function () {
          $(this).find('.btn-cer-arrow-r').attr('src','/wp-content/themes/DamcoNew/assets/images/icons/right-cer-w-ico.png');
       }, 
       function () {
          $(this).find('.btn-cer-arrow-r').attr('src','/wp-content/themes/DamcoNew/assets/images/icons/right-cer-ico.png');
       }
	)

	// $('.main-menu .navigation .inside-mega-menu li.dropdown').hover(
	// 	function () {
	// 	  $('.main-menu .navigation .inside-mega-menu li.dropdown').removeClass('active');
 //          $(this).children().children('.dropdown-btn').css('color','#ffffff');
 //          $(this).children().children('.dropdown-btn').children().removeClass('fa-angle-right').addClass('fa-angle-down');
	// 	  $(this).children('ul.inmenu').slideDown();
	// 	  $(this).addClass('active');
 //       }
 //       , 
	//    function () {
	// 	  	$(this).children().children('.dropdown-btn').css('color','#1e232a');
	// 	    $(this).children().children('.dropdown-btn').children().removeClass('fa-angle-down').addClass('fa-angle-right');
	// 		$(this).children('ul.inmenu').slideUp();
	//       	$(this).removeClass('active');
		      		
	//    }
	// )

	// --------------------- //

	// $('.main-menu .navigation li.dropdown.main-nav > a').append('<div class="dropdown-btn" style="display:none;top: 10px;right: 0px;border: none;"><span class="fa fa-plus"></span></div>');
	// $('.main-menu .navigation .inside-mega-menu li.dropdown > a').append('<div class="dropdown-btn" style="display:block;top: 3px;right: 0px;border: none;"><span class="fa fa-plus"></span></div>');
	// $('.main-menu .navigation li.dropdown a').next().hide();
	
	// $('li.dropdown.main-nav > a').hover(function(){
	// 	$('.main-menu .navigation .inside-mega-menu li.dropdown .dropdown-btn').css('color','#221528');
	// 		$('.main-menu .navigation .inside-mega-menu li.dropdown .dropdown-btn span').removeClass('fa-minus').addClass('fa-plus');
	// 		$('.dropdown-menu a').css('color','#221528');
	// 		$('.dropdown-menu a').css('background','transparent');
	// 		$('ul.inmenu').slideUp(200);
	// })
	// $('.main-menu .navigation .inside-mega-menu li.dropdown .dropdown-btn').click(function(){
	// 	if($(this).children().attr('class') == 'fa fa-plus'){
	// 		$('.main-menu .navigation .inside-mega-menu li.dropdown .dropdown-btn').css('color','#221528');
	// 		$('.main-menu .navigation .inside-mega-menu li.dropdown .dropdown-btn span').removeClass('fa-minus').addClass('fa-plus');
	// 		$('.dropdown-menu a').css('color','#221528');
	// 		$('.dropdown-menu a').css('background','transparent');
	// 		$('ul.inmenu').slideUp(200);
	// 		$(this).children().removeClass('fa-plus').addClass('fa-minus');
	// 		$(this).parent().next().slideDown(200);
	// 		$(this).parent().css('color','#ffffff');
	// 		$(this).parent().css('background','#f00b0b');
	// 		$(this).css('color','#ffffff')
	// 	}else if($(this).children().attr('class') == 'fa fa-minus'){
	// 		$(this).children().removeClass('fa-minus').addClass('fa-plus');
	// 		$(this).parent().next().slideUp(200);
	// 		$(this).parent().css('color','#221528');
	// 		$(this).parent().css('background','transparent');
	// 		$(this).css('color','#221528')
	// 	}
	// })

	// $('li.dropdown.main-nav > a').onload(function(){
	// 	$('.main-menu .navigation .inside-mega-menu li.dropdown .dropdown-btn').css('color','#221528');
	// 		$('.main-menu .navigation .inside-mega-menu li.dropdown .dropdown-btn span').removeClass('fa-minus').addClass('fa-plus');
	// 		$('.dropdown-menu a').css('color','#221528');
	// 		$('.dropdown-menu a').css('background','transparent');
	// 		$('ul.inmenu').slideUp(200);
	// })
	// if(window.innerWidth < 768) {
	// 	mobileOnlySlider();
	// }

})(window.jQuery);

// function mobileOnlySlider() {
// 	$('.slick-servics1').owlCarousel({
// 	    loop:true,
// 	    responsive:{
// 	        0:{
// 	            items:1,
// 	            nav:false,
// 	            loop:true
// 	        },
// 	        600:{
// 	            items:1,
// 	            nav:false
// 	        }
// 	    }
// 	})
// }

/*
$(document).ready(function(){
	console.log("testttt");
});
setTimeout(function () {
	console.log("testttt2");
}, 2500);

*/


$('.blog-slider').slick({
	slidesToShow: 1,
          slidesToScroll: 1,
          autoplay: true,
          arrows: false,
          fade: true,
          adaptiveHeight: true,
          asNavFor: '.blog-slider-nav'
  });

  $('.blog-slider-nav').slick({
	slidesToShow: 4,
        slidesToScroll: 1,
        autoplay: true,
        asNavFor: '.blog-slider',
        dots: false,
        centerMode: true,
        focusOnSelect: true,
        variableWidth: true
  });



$('.tech-slick-slider').slick({
	dots: true,
	infinite: true,
	autoplay: true,
	speed: 300,
	slidesToShow: 4,
	slidesToScroll: 4,
	responsive: [
	  {
		breakpoint: 1024,
		settings: {
		  slidesToShow: 3,
		  slidesToScroll: 3,
		  infinite: true,
		  dots: true
		}
	  },
	  {
		breakpoint: 600,
		settings: {
		  slidesToShow: 2,
		  slidesToScroll: 2
		}
	  },
	  {
		breakpoint: 480,
		settings: {
		  slidesToShow: 1,
		  slidesToScroll: 1
		}
	  }
	]
  });
  

  $('.industry-slick-slider').slick({
	dots: true,
	infinite: true,
	autoplay: true,
	speed: 300,
	slidesToShow: 4,
	slidesToScroll: 4,
	responsive: [
	  {
		breakpoint: 1024,
		settings: {
		  slidesToShow: 3,
		  slidesToScroll: 3,
		  infinite: true,
		  dots: true
		}
	  },
	  {
		breakpoint: 600,
		settings: {
		  slidesToShow: 2,
		  slidesToScroll: 2
		}
	  },
	  {
		breakpoint: 480,
		settings: {
		  slidesToShow: 1,
		  slidesToScroll: 1
		}
	  }
	]
  });
  
 
  
  $('.industry-slick-slider').slick({
	dots: true,
	infinite: true,
	autoplay: true,
	speed: 300,
	slidesToShow: 4,
	slidesToScroll: 4,
	responsive: [
	  {
		breakpoint: 1024,
		settings: {
		  slidesToShow: 3,
		  slidesToScroll: 3,
		  infinite: true,
		  dots: true
		}
	  },
	  {
		breakpoint: 600,
		settings: {
		  slidesToShow: 2,
		  slidesToScroll: 2
		}
	  },
	  {
		breakpoint: 480,
		settings: {
		  slidesToShow: 1,
		  slidesToScroll: 1
		}
	  }
	]
  });

  $('.imgCardWrapper').slick({
	dots: true,
	arrows: false,
	infinite: true,
	slidesToShow: 1,
	slidesToScroll: 1
  });
  

  
  if ($('.appScreen').length) {
		var newsCarousel = new Swiper('.appScreen', {
			loop: false,
			spaceBetween: 0,
			slidesPerView: 1,
			initialSlide: 1,
			freeMode: true,
			speed: 1400,
			watchSlidesVisibility: true,
			watchSlidesProgress: true,
			observer: true,
			slideActiveClass: 'swiper-slide-active',
			autoplay: {
			    delay: 5000,
			},
			navigation: {
				nextEl: '.swiper-button-next',
				prevEl: '.swiper-button-prev',
			},
            breakpoints: {
                991: {
                  slidesPerView: 1,
                },
                640: {
                  slidesPerView: 1,
                },
            },
            scrollbar: {
			    el: '.swiper-scrollbar',
			    draggable: true,
			},
		});
	}